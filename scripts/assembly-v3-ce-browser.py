#!/usr/bin/env python3
"""CDP probe: morph on (dwell M0/M3 flags) vs ?morph=0, plus egg."""

from __future__ import annotations

import base64
import json
import socket
import subprocess
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

OUT = Path("/opt/cursor/artifacts/screenshots")
OUT.mkdir(parents=True, exist_ok=True)
REPORT = Path("/workspace/painting/assembly-v3-ce-browser.json")


def _ws_handshake(sock, url: str) -> None:
    u = urlparse(url)
    key = "dGhlIHNhbXBsZSBub25jZQ=="
    req = (
        f"GET {u.path or '/'} HTTP/1.1\r\n"
        f"Host: {u.hostname}:{u.port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(req.encode())
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("CDP handshake closed")
        data += chunk
    if b"101" not in data.split(b"\r\n", 1)[0]:
        raise RuntimeError(f"CDP handshake failed: {data[:200]!r}")


def _mask(payload: bytes) -> bytes:
    key = b"\x01\x02\x03\x04"
    return key + bytes(b ^ key[i % 4] for i, b in enumerate(payload))


def _send(sock, payload: dict) -> None:
    raw = json.dumps(payload).encode()
    header = bytearray()
    header.append(0x81)
    n = len(raw)
    if n < 126:
        header.append(0x80 | n)
    elif n < 65536:
        header.append(0x80 | 126)
        header.extend(n.to_bytes(2, "big"))
    else:
        header.append(0x80 | 127)
        header.extend(n.to_bytes(8, "big"))
    sock.sendall(bytes(header) + _mask(raw))


def _recv(sock) -> dict:
    hdr = b""
    while len(hdr) < 2:
        hdr += sock.recv(2 - len(hdr))
    ln = hdr[1] & 0x7F
    if ln == 126:
        ext = sock.recv(2)
        ln = int.from_bytes(ext, "big")
    elif ln == 127:
        ext = sock.recv(8)
        ln = int.from_bytes(ext, "big")
    data = b""
    while len(data) < ln:
        data += sock.recv(ln - len(data))
    try:
        return json.loads(data.decode())
    except Exception:
        return {}


def cdp(sock, method: str, params: dict | None, msg_id: int):
    payload = {"id": msg_id, "method": method}
    if params:
        payload["params"] = params
    _send(sock, payload)
    while True:
        msg = _recv(sock)
        if msg.get("id") == msg_id:
            if "error" in msg:
                raise RuntimeError(msg["error"])
            return msg.get("result", {})


def eval_js(sock, expr: str, msg_id: int):
    res = cdp(
        sock,
        "Runtime.evaluate",
        {"expression": expr, "returnByValue": True, "awaitPromise": False},
        msg_id,
    )
    return res.get("result", {}).get("value")


def shot(sock, name: str, msg_id: int) -> str:
    res = cdp(sock, "Page.captureScreenshot", {"format": "png"}, msg_id)
    dest = OUT / name
    dest.write_bytes(base64.b64decode(res["data"]))
    return str(dest)


PROBE = """(() => {
  const r = window.__nfRadial || {};
  const pix = window.__nfPixiLive || {};
  return {
    mode: pix.mode,
    scene: r.scene,
    on: r.on,
    n: r.n,
    phase: r.phase,
    handbookShape: r.handbookShape,
    lifecycle: r.lifecycle,
    recycle: r.recycle,
    boundaryQ: r.boundaryQ,
    ripple: r.ripple,
    streak: r.streak,
    morphRamp: r.morphRamp,
    escP95: r.escP95,
    tintMin: r.tintMin,
    tintMean: r.tintMean
  };
})()"""


def wait_probe(sock, pred, timeout, msg_id):
    end = time.time() + timeout
    info = None
    while time.time() < end:
        info = eval_js(sock, PROBE, msg_id)
        if info and pred(info):
            return info
        time.sleep(0.25)
    return info


def navigate(sock, url: str, msg_id: int) -> None:
    cdp(sock, "Page.navigate", {"url": url}, msg_id)
    time.sleep(1.8)


def main() -> int:
    port = 9335
    chrome = subprocess.Popen(
        [
            "google-chrome",
            "--headless=new",
            "--window-size=1440,900",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"--remote-debugging-port={port}",
            "--user-data-dir=/tmp/chrome-assembly-ce",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    failed = []
    try:
        ws_url = None
        for _ in range(50):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json") as res:
                    tabs = json.loads(res.read().decode())
                if tabs and tabs[0].get("webSocketDebuggerUrl"):
                    ws_url = tabs[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                time.sleep(0.1)
        if not ws_url:
            raise SystemExit("no CDP websocket")
        u = urlparse(ws_url)
        sock = socket.create_connection((u.hostname, u.port), timeout=10)
        sock.settimeout(30)
        _ws_handshake(sock, ws_url)
        cdp(sock, "Page.enable", None, 1)
        cdp(sock, "Runtime.enable", None, 2)
        cdp(
            sock,
            "Emulation.setDeviceMetricsOverride",
            {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False},
            3,
        )

        navigate(sock, "http://127.0.0.1:8768/?autoplay=0&dpr=1", 4)
        eval_js(
            sock,
            "document.getElementById('btn-intro') && document.getElementById('btn-intro').click()",
            5,
        )
        formed = wait_probe(sock, lambda p: p.get("mode") == "formed" and p.get("on"), 22, 10)
        dwell = wait_probe(
            sock,
            lambda p: p.get("mode") == "formed" and p.get("morphRamp", 0) >= 0.4,
            35,
            11,
        )
        p_dwell = shot(sock, "assembly-ce-dwell-morph.png", 12)
        if not dwell or not dwell.get("lifecycle") or not dwell.get("ripple") or not dwell.get("streak"):
            failed.append("morph flags off on default")
        if dwell and dwell.get("morphRamp", 0) < 0.15:
            failed.append(f"ramp too small {dwell.get('morphRamp')}")

        eval_js(
            sock,
            "document.getElementById('btn-egg') && document.getElementById('btn-egg').click()",
            13,
        )
        time.sleep(4.5)
        egg = wait_probe(sock, lambda p: p.get("scene") == "glyph" or p.get("mode") in ("assemble", "formed"), 3, 14)
        p_egg = shot(sock, "assembly-ce-egg.png", 15)
        if not egg or not egg.get("on"):
            failed.append("egg lost radial")

        navigate(sock, "http://127.0.0.1:8768/?autoplay=0&dpr=1&morph=0", 16)
        eval_js(
            sock,
            "document.getElementById('btn-intro') && document.getElementById('btn-intro').click()",
            17,
        )
        off = wait_probe(sock, lambda p: p.get("on") and p.get("mode") in ("assemble", "formed"), 8, 18)
        time.sleep(2.0)
        off = wait_probe(sock, lambda p: True, 1, 19)
        p_off = shot(sock, "assembly-ce-morph-off.png", 20)
        if not off or off.get("ripple") or off.get("streak") or off.get("lifecycle"):
            failed.append(f"morph=0 still on {off}")
        if off and not off.get("handbookShape"):
            failed.append("morph=0 dropped handbookShape")

        report = {
            "task": "assembly-v3-CE-browser",
            "dwell": dwell,
            "egg": egg,
            "morph0": off,
            "shots": [p_dwell, p_egg, p_off],
            "formed_first": formed,
            "pass": len(failed) == 0,
            "failed": failed,
        }
        REPORT.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        return 0 if not failed else 1
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=3)
        except subprocess.TimeoutExpired:
            chrome.kill()


if __name__ == "__main__":
    raise SystemExit(main())
