#!/usr/bin/env python3
"""
Decrypt WeChat SQLCipher 4 databases using keys from extract_keys.py.

Reads data/wechat_keys.json and decrypts each database using sqlcipher,
writing plaintext SQLite files to data/decrypted/.

Usage:
    python3 scripts/decrypt_dbs.py

Requirements:
    - brew install sqlcipher
"""
import os
import sys
import json
import glob
import subprocess
import shutil

# ── Config ──

DB_DIR = os.path.expanduser(
    "~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files"
)
KEYS_FILE = os.environ.get("WECHAT_KEYS_FILE", "data/wechat_keys.json")
OUTPUT_DIR = os.environ.get("DECRYPT_OUTPUT_DIR", "data/decrypted")


def find_sqlcipher():
    """Find sqlcipher binary."""
    for path in [
        "/opt/homebrew/opt/sqlcipher/bin/sqlcipher",
        "/usr/local/opt/sqlcipher/bin/sqlcipher",
        shutil.which("sqlcipher"),
    ]:
        if path and os.path.isfile(path):
            return path
    return None


def find_db_dir():
    """Auto-detect the db_storage directory."""
    pattern = os.path.join(DB_DIR, "*", "db_storage")
    candidates = glob.glob(pattern)
    if candidates:
        return candidates[0]
    return None


def main():
    sqlcipher = find_sqlcipher()
    if not sqlcipher:
        print("[-] sqlcipher not found. Install with: brew install sqlcipher")
        sys.exit(1)

    print(f"[*] Using sqlcipher: {sqlcipher}")

    # Load keys
    if not os.path.exists(KEYS_FILE):
        print(f"[-] Keys file not found: {KEYS_FILE}")
        print("[!] Run extract_keys.py first")
        sys.exit(1)

    with open(KEYS_FILE, "r") as f:
        keys = json.load(f)

    # Filter out metadata keys
    db_keys = {k: v for k, v in keys.items() if not k.startswith("__")}
    print(f"[*] Loaded {len(db_keys)} database keys")

    # Find db_storage directory
    db_dir = find_db_dir()
    if not db_dir:
        print(f"[-] Could not find db_storage directory under {DB_DIR}")
        sys.exit(1)

    print(f"[*] DB storage: {db_dir}")
    print(f"[*] Decrypting {len(db_keys)} databases to {OUTPUT_DIR}/\n")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    success = 0
    failed = 0

    for rel_path, key_hex in sorted(db_keys.items()):
        src = os.path.join(db_dir, rel_path)
        dst = os.path.join(OUTPUT_DIR, rel_path)

        if not os.path.exists(src):
            print(f"  [-] Source not found: {rel_path}")
            failed += 1
            continue

        # Create output directory
        os.makedirs(os.path.dirname(dst), exist_ok=True)

        # Remove existing decrypted file
        if os.path.exists(dst):
            os.remove(dst)

        # Decrypt using sqlcipher
        sql_commands = f"""
PRAGMA key = "x'{key_hex}'";
PRAGMA cipher_compatibility = 4;
ATTACH DATABASE '{dst}' AS plaintext KEY '';
SELECT sqlcipher_export('plaintext');
DETACH DATABASE plaintext;
"""
        try:
            result = subprocess.run(
                [sqlcipher, src],
                input=sql_commands,
                capture_output=True,
                text=True,
                timeout=60,
            )

            if result.returncode != 0:
                print(f"  [-] {rel_path}: sqlcipher error: {result.stderr.strip()}")
                failed += 1
                continue

            # Verify output is a valid SQLite file
            if os.path.exists(dst):
                with open(dst, "rb") as f:
                    header = f.read(16)
                if header[:6] == b"SQLite":
                    size_kb = os.path.getsize(dst) // 1024
                    print(f"  [+] {rel_path} ({size_kb} KB)")
                    success += 1
                else:
                    print(f"  [-] {rel_path}: output is not valid SQLite")
                    os.remove(dst)
                    failed += 1
            else:
                print(f"  [-] {rel_path}: no output file created")
                failed += 1

        except subprocess.TimeoutExpired:
            print(f"  [-] {rel_path}: timeout")
            failed += 1
        except Exception as e:
            print(f"  [-] {rel_path}: {e}")
            failed += 1

    print(f"\n[*] Done: {success} decrypted, {failed} failed")
    print(f"[*] Decrypted files saved to: {os.path.abspath(OUTPUT_DIR)}/")


if __name__ == "__main__":
    main()
