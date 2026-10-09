use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use std::{env, fs};

fn verify() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        return Err("用法：moon-release-verifier <installer> <signature> <version>".into());
    }
    let public_key = env::var("MOON_UPDATER_PUBLIC_KEY")?;
    let public_key = String::from_utf8(STANDARD.decode(public_key.trim())?)?;
    let signature = String::from_utf8(STANDARD.decode(fs::read_to_string(&args[2])?.trim())?)?;
    let public_key = PublicKey::decode(&public_key)?;
    let signature = Signature::decode(&signature)?;
    // 先由成熟实现验包和可信注释，再读绑定版本；不能信任未验签的清单。
    public_key.verify(&fs::read(&args[1])?, &signature, true)?;
    let expected = format!("version:{}", args[3]);
    if !signature
        .trusted_comment()
        .split('\t')
        .any(|part| part == expected)
    {
        return Err("可信签名未绑定本次产品版本".into());
    }
    println!("安装包签名及绑定版本验证通过");
    Ok(())
}

fn main() {
    if verify().is_err() {
        // 不输出密钥、签名材料或文件内容。
        eprintln!("安装包签名验证失败，请检查发行公钥、安装包和产品版本");
        std::process::exit(1);
    }
}
