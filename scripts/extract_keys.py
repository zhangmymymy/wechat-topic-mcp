#!/usr/bin/env python3
"""
Extract WeChat database encryption keys by hooking CCKeyDerivationPBKDF via Frida.

WeChat macOS 4.x uses statically-linked SQLCipher 4 (AES-256-CBC, HMAC-SHA512,
PBKDF2 with 256,000 iterations). All symbols are stripped, but the PBKDF2 key
derivation ultimately calls macOS's CCKeyDerivationPBKDF from libcommonCrypto.dylib
— a system export that Frida can always hook.

Usage:
    python3 scripts/extract_keys.py

Requirements:
    - macOS (Apple Silicon)
    - SIP disabled (csrutil disable)
    - pip3 install frida-tools
    - WeChat installed (will be spawned automatically)
"""
import frida
import sys
import os
import json
import glob
import time
import signal

# ── Config ──

WECHAT_BUNDLE = "com.tencent.xinWeChat"
WECHAT_BIN = "/Applications/WeChat.app/Contents/MacOS/WeChat"
DB_DIR = os.path.expanduser(
    "~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files"
)
OUTPUT_FILE = os.environ.get("WECHAT_KEYS_OUTPUT", "data/wechat_keys.json")

PAGE_SZ = 4096
SALT_SZ = 16
KEY_SZ = 32
ENC_ROUNDS = 256000
HMAC_ROUNDS = 2

# ── Frida JS hook script ──

HOOK_SCRIPT = """
'use strict';

const CCKeyDerivationPBKDF = Module.findExportByName('libcommonCrypto.dylib', 'CCKeyDerivationPBKDF');

if (!CCKeyDerivationPBKDF) {
    console.log('[!] CCKeyDerivationPBKDF not found');
} else {
    Interceptor.attach(CCKeyDerivationPBKDF, {
        onEnter(args) {
            // CCKeyDerivationPBKDF(algorithm, password, passwordLen, salt, saltLen,
            //                      prf, rounds, derivedKey, derivedKeyLen)
            this.rounds = args[6].toInt32();
            this.saltLen = args[4].toInt32();
            this.dkLen = args[8].toInt32();

            if (this.saltLen === 16 && this.dkLen === 32) {
                this.salt = args[3].readByteArray(16);
                this.derivedKeyPtr = args[7];
                this.capture = true;
            } else {
                this.capture = false;
            }
        },
        onLeave(retval) {
            if (!this.capture) return;

            const dk = this.derivedKeyPtr.readByteArray(32);
            const saltHex = Array.from(new Uint8Array(this.salt)).map(b => ('0' + b.toString(16)).slice(-2)).join('');
            const dkHex = Array.from(new Uint8Array(dk)).map(b => ('0' + b.toString(16)).slice(-2)).join('');

            send({
                type: 'pbkdf2',
                rounds: this.rounds,
                salt: saltHex,
                derivedKey: dkHex
            });
        }
    });

    console.log('[*] CCKeyDerivationPBKDF hook installed');
}
"""


def find_db_dir():
    """Auto-detect the db_storage directory."""
    pattern = os.path.join(DB_DIR, "*", "db_storage")
    candidates = glob.glob(pattern)
    if candidates:
        return candidates[0]
    return None


def collect_db_salts(db_dir):
    """Read first 16 bytes (salt) of each encrypted .db file."""
    salt_to_dbs = {}  # salt_hex -> [relative_path, ...]
    for root, dirs, files in os.walk(db_dir):
        for f in files:
            if not f.endswith(".db"):
                continue
            path = os.path.join(root, f)
            rel = os.path.relpath(path, db_dir)
            sz = os.path.getsize(path)
            if sz < PAGE_SZ:
                continue
            with open(path, "rb") as fh:
                header = fh.read(16)
            # Skip if it's already a plaintext SQLite DB
            if header[:6] == b"SQLite":
                continue
            salt_hex = header.hex()
            salt_to_dbs.setdefault(salt_hex, []).append(rel)
    return salt_to_dbs


def main():
    print("=" * 60)
    print("  WeChat Key Extractor (Frida + CCKeyDerivationPBKDF)")
    print("=" * 60)

    # 1. Find encrypted databases and their salts
    db_dir = find_db_dir()
    if not db_dir:
        print(f"[-] Could not find db_storage directory under {DB_DIR}")
        print("[!] Is WeChat installed and logged in?")
        sys.exit(1)

    salt_to_dbs = collect_db_salts(db_dir)
    total_dbs = sum(len(v) for v in salt_to_dbs.values())
    print(f"\n[*] Found {total_dbs} encrypted databases ({len(salt_to_dbs)} unique salts)")

    if not salt_to_dbs:
        print("[-] No encrypted databases found")
        sys.exit(1)

    # 2. Kill existing WeChat
    print("\n[*] Killing existing WeChat process...")
    os.system("pkill -x WeChat 2>/dev/null")
    time.sleep(2)

    # 3. Spawn WeChat with Frida
    print("[*] Spawning WeChat with Frida hooks...")

    captured_keys = {}  # salt_hex -> enc_key_hex
    remaining_salts = set(salt_to_dbs.keys())

    def on_message(message, data):
        nonlocal captured_keys, remaining_salts
        if message["type"] == "send":
            payload = message["payload"]
            if payload.get("type") == "pbkdf2":
                rounds = payload["rounds"]
                salt = payload["salt"]
                dk = payload["derivedKey"]

                # We only care about encryption keys (256000 rounds)
                if rounds == ENC_ROUNDS and salt in remaining_salts:
                    captured_keys[salt] = dk
                    remaining_salts.discard(salt)
                    dbs = salt_to_dbs[salt]
                    for db in dbs:
                        print(f"  [+] Key captured: {db}")

                    if not remaining_salts:
                        print(f"\n[*] All {len(salt_to_dbs)} keys captured!")
        elif message["type"] == "error":
            print(f"  [!] Frida error: {message.get('description', message)}")

    try:
        device = frida.get_local_device()
        pid = device.spawn([WECHAT_BIN])
        session = device.attach(pid)
        script = session.create_script(HOOK_SCRIPT)
        script.on("message", on_message)
        script.load()

        print("[*] Resuming WeChat (waiting for DB opens)...")
        device.resume(pid)

        # Wait for keys with timeout
        timeout = 60
        start = time.time()
        while remaining_salts and (time.time() - start) < timeout:
            time.sleep(0.5)

        if remaining_salts:
            print(f"\n[!] Timeout: {len(remaining_salts)} keys not captured")
            for salt in remaining_salts:
                for db in salt_to_dbs[salt]:
                    print(f"  [-] Missing: {db}")

        # Detach
        session.detach()

    except frida.ServerNotRunningError:
        print("[-] Frida server not running. Is frida-tools installed?")
        sys.exit(1)
    except frida.NotSupportedError as e:
        print(f"[-] Frida error: {e}")
        print("[!] Is SIP disabled? (csrutil status)")
        sys.exit(1)
    except Exception as e:
        print(f"[-] Error: {e}")
        sys.exit(1)

    # 4. Save results
    if not captured_keys:
        print("\n[-] No keys captured!")
        sys.exit(1)

    # Build output: db_relative_path -> key_hex
    result = {}
    for salt_hex, key_hex in captured_keys.items():
        for db_path in salt_to_dbs[salt_hex]:
            result[db_path] = key_hex

    # Ensure output directory exists
    out_dir = os.path.dirname(OUTPUT_FILE)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    # Merge with existing keys if file exists
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, "r") as f:
                existing = json.load(f)
            existing.update(result)
            result = existing
        except Exception:
            pass

    with open(OUTPUT_FILE, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    key_count = len([k for k in result if not k.startswith("__")])
    print(f"\n[*] Saved {key_count} keys to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
