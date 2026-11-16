import {
  registerRemoteDirectoryPort,
  registerRemoteEntryPort,
  registerRemoteUploadPort,
} from "@/lib/rpc/remote-ports"
import { connectRemote, readConnection } from "./client"
import { chooseRemoteDirectory } from "./directory-chooser"
import {
  chooseRemoteFiles,
  discardRemoteFile,
  uploadRemoteFile,
} from "./upload-client"

export function registerRemoteAccessPorts() {
  registerRemoteEntryPort({ readConnection, connectRemote })
  registerRemoteDirectoryPort({ chooseRemoteDirectory })
  registerRemoteUploadPort({
    uploadRemoteFile,
    discardRemoteFile,
    chooseRemoteFiles,
  })
}
