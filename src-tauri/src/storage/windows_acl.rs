use std::{
    fs::{self, OpenOptions},
    os::windows::{
        ffi::OsStrExt,
        io::{FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr::{null, null_mut},
};
use uuid::Uuid;
use windows_sys::Win32::{
    Foundation::{ERROR_SUCCESS, LocalFree},
    Security::{
        ACCESS_ALLOWED_ACE, ACE_HEADER, ACE_INHERITED_OBJECT_TYPE_PRESENT, ACE_OBJECT_TYPE_PRESENT,
        ACL, ACL_REVISION, ACL_SIZE_INFORMATION, AclSizeInformation, AddAccessAllowedAceEx,
        Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT, SetNamedSecurityInfoW},
        CONTAINER_INHERIT_ACE, CreateWellKnownSid, DACL_SECURITY_INFORMATION, EqualSid, GetAce,
        GetAclInformation, GetSecurityDescriptorControl, GetTokenInformation, INHERIT_ONLY_ACE,
        InitializeAcl, IsValidAcl, IsValidSid, OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SE_DACL_PROTECTED,
        SECURITY_MAX_SID_SIZE, TOKEN_QUERY, TOKEN_USER, TokenUser, WELL_KNOWN_SID_TYPE,
        WinBuiltinAdministratorsSid, WinLocalSystemSid,
    },
    Storage::FileSystem::FILE_ALL_ACCESS,
    System::{
        SystemServices::{
            ACCESS_ALLOWED_ACE_TYPE, ACCESS_ALLOWED_CALLBACK_ACE_TYPE,
            ACCESS_ALLOWED_CALLBACK_OBJECT_ACE_TYPE, ACCESS_ALLOWED_OBJECT_ACE_TYPE,
            ACCESS_DENIED_ACE_TYPE, ACCESS_DENIED_CALLBACK_ACE_TYPE,
            ACCESS_DENIED_CALLBACK_OBJECT_ACE_TYPE, ACCESS_DENIED_OBJECT_ACE_TYPE,
        },
        Threading::{GetCurrentProcess, OpenProcessToken},
    },
};

const SID_WORDS: usize = (SECURITY_MAX_SID_SIZE as usize).div_ceil(size_of::<u32>());

struct Descriptor {
    raw: PSECURITY_DESCRIPTOR,
    owner: PSID,
    dacl: *mut ACL,
}

impl Descriptor {
    fn read(path: &[u16]) -> Result<Self, ()> {
        let mut result = Self {
            raw: null_mut(),
            owner: null_mut(),
            dacl: null_mut(),
        };
        // The owner and DACL pointers borrow the allocated security descriptor.
        let status = unsafe {
            GetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut result.owner,
                null_mut(),
                &mut result.dacl,
                null_mut(),
                &mut result.raw,
            )
        };
        (status == ERROR_SUCCESS && !result.owner.is_null())
            .then_some(result)
            .ok_or(())
    }

    fn owned_by(&self, user: PSID) -> bool {
        unsafe { EqualSid(user, self.owner) != 0 }
    }

    fn verify_dacl(&self, trustees: [PSID; 3]) -> Result<(), ()> {
        let mut control = 0;
        let mut revision = 0;
        let mut info = ACL_SIZE_INFORMATION::default();
        // Win32 validates the ACL and retrieves each entry within that allocation.
        unsafe {
            if GetSecurityDescriptorControl(self.raw, &mut control, &mut revision) == 0
                || control & SE_DACL_PROTECTED == 0
                || self.dacl.is_null()
                || IsValidAcl(self.dacl) == 0
                || GetAclInformation(
                    self.dacl,
                    (&mut info as *mut ACL_SIZE_INFORMATION).cast(),
                    size_of::<ACL_SIZE_INFORMATION>() as u32,
                    AclSizeInformation,
                ) == 0
            {
                return Err(());
            }
            let mut full_control = false;
            for index in 0..info.AceCount {
                let mut ace = null_mut();
                if GetAce(self.dacl, index, &mut ace) == 0 {
                    return Err(());
                }
                let header = &*ace.cast::<ACE_HEADER>();
                let kind = u32::from(header.AceType);
                if matches!(
                    kind,
                    ACCESS_DENIED_ACE_TYPE
                        | ACCESS_DENIED_OBJECT_ACE_TYPE
                        | ACCESS_DENIED_CALLBACK_ACE_TYPE
                        | ACCESS_DENIED_CALLBACK_OBJECT_ACE_TYPE
                ) {
                    continue;
                }
                let bytes =
                    std::slice::from_raw_parts(ace.cast::<u8>(), usize::from(header.AceSize));
                let offset = match kind {
                    ACCESS_ALLOWED_ACE_TYPE | ACCESS_ALLOWED_CALLBACK_ACE_TYPE => 8,
                    ACCESS_ALLOWED_OBJECT_ACE_TYPE | ACCESS_ALLOWED_CALLBACK_OBJECT_ACE_TYPE => {
                        let flags = u32::from_le_bytes(
                            bytes.get(8..12).ok_or(())?.try_into().map_err(|_| ())?,
                        );
                        let guid_flags =
                            ACE_OBJECT_TYPE_PRESENT | ACE_INHERITED_OBJECT_TYPE_PRESENT;
                        if flags & !guid_flags != 0 {
                            return Err(());
                        }
                        12 + 16 * (flags & guid_flags).count_ones() as usize
                    }
                    _ => return Err(()),
                };
                let sid = bytes.get(offset..).ok_or(())?;
                let count = usize::from(*sid.get(1).ok_or(())?);
                if sid.len() < 8 + 4 * count {
                    return Err(());
                }
                let sid = sid.as_ptr().cast_mut().cast();
                if IsValidSid(sid) == 0
                    || !trustees.iter().any(|&allowed| EqualSid(allowed, sid) != 0)
                {
                    return Err(());
                }
                if kind == ACCESS_ALLOWED_ACE_TYPE
                    && u32::from(header.AceFlags) & INHERIT_ONLY_ACE == 0
                    && EqualSid(trustees[0], sid) != 0
                {
                    let mask = (*ace.cast::<ACCESS_ALLOWED_ACE>()).Mask;
                    full_control |= mask & FILE_ALL_ACCESS == FILE_ALL_ACCESS;
                }
            }
            full_control.then_some(()).ok_or(())
        }
    }
}

impl Drop for Descriptor {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            unsafe { LocalFree(self.raw) };
        }
    }
}

fn current_user_sid(buffer: &mut [usize]) -> Result<PSID, ()> {
    let mut token = null_mut();
    // The aligned buffer holds TOKEN_USER and the variable-length SID it points to.
    unsafe {
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(());
        }
        let _token = OwnedHandle::from_raw_handle(token);
        let mut written = 0;
        if GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            size_of_val(buffer) as u32,
            &mut written,
        ) == 0
        {
            return Err(());
        }
        Ok((*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid)
    }
}

fn well_known_sid(kind: WELL_KNOWN_SID_TYPE, buffer: &mut [u32; SID_WORDS]) -> Result<PSID, ()> {
    let sid = buffer.as_mut_ptr().cast();
    let mut size = SECURITY_MAX_SID_SIZE;
    (unsafe { CreateWellKnownSid(kind, null_mut(), sid, &mut size) } != 0)
        .then_some(sid)
        .ok_or(())
}

fn protect_directory(path: &[u16], trustees: [PSID; 3], set_owner: bool) -> Result<(), ()> {
    // Each ACCESS_ALLOWED_ACE contains a DWORD that is also the start of its SID.
    let mut acl = [0u32; size_of::<ACL>() / 4 + 3 * (SID_WORDS + 2)];
    let size = size_of_val(&acl) as u32;
    let acl = acl.as_mut_ptr().cast::<ACL>();
    unsafe {
        if InitializeAcl(acl, size, ACL_REVISION) == 0 {
            return Err(());
        }
        for sid in trustees {
            if AddAccessAllowedAceEx(
                acl,
                ACL_REVISION,
                CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE,
                FILE_ALL_ACCESS,
                sid,
            ) == 0
            {
                return Err(());
            }
        }
        let mut information = PROTECTED_DACL_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
        if set_owner {
            information |= OWNER_SECURITY_INFORMATION;
        }
        (SetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            information,
            trustees[0],
            null_mut(),
            acl,
            null(),
        ) == ERROR_SUCCESS)
            .then_some(())
            .ok_or(())
    }
}

pub(super) fn verify(path: &Path, existed: bool, initialize: bool) -> Result<(), ()> {
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut user = [0usize;
        (size_of::<TOKEN_USER>() + SECURITY_MAX_SID_SIZE as usize).div_ceil(size_of::<usize>())];
    let mut system = [0; SID_WORDS];
    let mut administrators = [0; SID_WORDS];
    let user = current_user_sid(&mut user)?;
    let trustees = [
        user,
        well_known_sid(WinLocalSystemSid, &mut system)?,
        well_known_sid(WinBuiltinAdministratorsSid, &mut administrators)?,
    ];
    let mut descriptor = Descriptor::read(&name)?;
    let correct_owner = descriptor.owned_by(user);
    if existed && !correct_owner {
        return Err(());
    }
    if initialize {
        protect_directory(&name, trustees, !correct_owner)?;
        descriptor = Descriptor::read(&name)?;
    }
    if !descriptor.owned_by(user) {
        return Err(());
    }
    descriptor.verify_dacl(trustees)?;
    let probe = path.join(format!(".moon-permission-{}", Uuid::new_v4()));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|_| ())?;
    drop(file);
    fs::remove_file(probe).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_owner_must_match_the_current_user() {
        let mut user_buffer = [0usize;
            (size_of::<TOKEN_USER>() + SECURITY_MAX_SID_SIZE as usize).div_ceil(size_of::<usize>())];
        let user = current_user_sid(&mut user_buffer).unwrap();
        let mut system = [0; SID_WORDS];
        let mut administrators = [0; SID_WORDS];
        let system = well_known_sid(WinLocalSystemSid, &mut system).unwrap();
        let administrators =
            well_known_sid(WinBuiltinAdministratorsSid, &mut administrators).unwrap();
        let alternate = if unsafe { EqualSid(user, system) } == 0 {
            system
        } else {
            administrators
        };
        let mut descriptor = Descriptor {
            raw: null_mut(),
            owner: user,
            dacl: null_mut(),
        };
        assert!(descriptor.owned_by(user));
        descriptor.owner = alternate;
        assert!(!descriptor.owned_by(user));
    }
}
