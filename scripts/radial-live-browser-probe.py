#!/usr/bin/env python3
"""Headless Chrome probe for live radial / rollback pages."""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _ws_handshake(sock, url: str) -> None:
    from urllib.parse import urlparse

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
    fin_opcode = hdr[0]
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
    if (fin_opcode & 0x0F) != 1:
        return {}
    return json.loads(data.decode())


def cdp_eval(sock, expr: str, msg_id: int) -> object:
    _send(sock, {"id": msg_id, "method": "Runtime.evaluate", "params": {"expression": expr, "returnByValue": True}})
    while True:
        msg = _recv(sock)
        if msg.get("id") == msg_id:
            if "error" in msg:
                raise RuntimeError(msg["error"])
            return msg.get("result", {}).get("result", {}).get("value")


def probe(url: str, wait_s: float = 6.0) -> dict:
    import socket
    from urllib.parse import urlparse

    port = 9333
    chrome = subprocess.Popen(
        [
            "google-chrome",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"--remote-debugging-port={port}",
            "--user-data-dir=/tmp/chrome-radial-probe",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        ws_url = None
        for _ in range(40):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json") as res:
                    tabs = json.loads(res.read().decode())
                if tabs:
                    ws_url = tabs[0].get("webSocketDebuggerUrl")
                    if ws_url:
                        break
            except Exception:
                time.sleep(0.1)
        if not ws_url:
            raise RuntimeError("no CDP websocket")
        u = urlparse(ws_url)
        sock = socket.create_connection((u.hostname, u.port), timeout=10)
        sock.settimeout(15)
        _ws_handshake(sock, ws_url)
        _send(sock, {"id": 1, "method": "Page.enable"})
        _send(sock, {"id": 2, "method": "Runtime.enable"})
        _send(sock, {"id": 3, "method": "Page.navigate", "params": {"url": url}})
        deadline = time.time() + wait_s + 4
        info = None
        while time.time() < deadline:
            try:
                info = cdp_eval(
                    sock,
                    """(() => {
                      const r = window.__nfRadial || null;
                      const p = window.__nfPoints || null;
                      const pix = window.__nfPixiLive || null;
                      const t = window.__nfLoadTimings || null;
                      return {
                        href: location.href,
                        radial: r,
                        count: p && p.count,
                        pointsId: p && p.id,
                        source: p && p.source,
                        hrefBin: t && t.href,
                        pixiN: pix && pix.n,
                        pixiReady: pix && pix.ready,
                        mode: pix && pix.mode,
                        spring: pix && pix.spring
                      };
                    })()""",
                    10,
                )
                if info and info.get("count") and info.get("radial") is not None:
                    break
            except Exception:
                pass
            time.sleep(0.4)
        if info and "autoplay=0" in url:
            cdp_eval(
                sock,
                """(() => {
                  const btn = document.getElementById('btn-intro');
                  if (btn) btn.click();
                  return true;
                })()""",
                11,
            )
            formed = None
            end = time.time() + 4
            while time.time() < end:
                formed = cdp_eval(
                    sock,
                    """(() => {
                      const r = window.__nfRadial || null;
                      const p = window.__nfPoints || null;
                      const pix = window.__nfPixiLive || null;
                      return {
                        radial: r,
                        count: p && p.count,
                        pointsId: p && p.id,
                        hrefBin: window.__nfLoadTimings && window.__nfLoadTimings.href,
                        pixiN: pix && pix.n,
                        mode: pix && pix.mode,
                        spring: pix && pix.spring
                      };
                    })()""",
                    12,
                )
                if formed and formed.get("mode") in ("assemble", "formed"):
                    info.update(formed)
                    info["afterIntro"] = formed
                    if formed.get("mode") == "formed":
                        break
                time.sleep(0.25)
            if "radial=0" not in url:
                cdp_eval(
                    sock,
                    """(() => {
                      const btn = document.getElementById('btn-egg');
                      if (btn) btn.click();
                      return true;
                    })()""",
                    13,
                )
                egg_end = time.time() + 4
                while time.time() < egg_end:
                    egg = cdp_eval(
                        sock,
                        """(() => {
                          const r = window.__nfRadial || null;
                          const p = window.__nfPoints || null;
                          const pix = window.__nfPixiLive || null;
                          return {
                            radial: r,
                            count: p && p.count,
                            mode: pix && pix.mode,
                            scene: r && r.scene,
                            handbookShape: r && r.handbookShape,
                            render: r && r.render
                          };
                        })()""",
                        14,
                    )
                    if egg and (egg.get("scene") == "glyph" or (egg.get("radial") or {}).get("scene") == "glyph"):
                        info["afterEgg"] = egg
                        break
                    time.sleep(0.25)
        return info or {}
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=3)
        except subprocess.TimeoutExpired:
            chrome.kill()


def main() -> None:
    pages = [
        ("radial_default", "http://127.0.0.1:8768/?autoplay=0&dpr=1"),
        ("radial_off", "http://127.0.0.1:8768/?radial=0&autoplay=0&dpr=1"),
    ]
    out = {}
    failed = []
    for name, url in pages:
        info = probe(url)
        out[name] = info
        if name == "radial_default":
            if not (info.get("radial") or {}).get("on"):
                failed.append("default radial not on")
            if info.get("count") != 50601:
                failed.append(f"default count {info.get('count')}")
            href = info.get("hrefBin") or ""
            if "dallas-radial-50k.bin" not in href:
                failed.append(f"default bin {href}")
            radial = info.get("radial") or {}
            if not radial.get("handbookShape"):
                failed.append("default handbookShape off")
            render = radial.get("render") or {}
            if render.get("backend") != "pixi":
                failed.append("default render backend")
            egg = info.get("afterEgg") or {}
            egg_scene = egg.get("scene") or (egg.get("radial") or {}).get("scene")
            if egg_scene != "glyph":
                failed.append(f"egg scene {egg_scene}")
        if name == "radial_off":
            if (info.get("radial") or {}).get("on"):
                failed.append("rollback radial still on")
            if info.get("count") != 100000:
                failed.append(f"rollback count {info.get('count')}")
            href = info.get("hrefBin") or ""
            if "dallas-100k.bin" not in href:
                failed.append(f"rollback bin {href}")
            if info.get("spring") not in (0.055, None):
                # pixi spring field should remain 0.055
                if info.get("spring") != 0.055:
                    failed.append(f"rollback spring {info.get('spring')}")
        print(json.dumps({name: info}, ensure_ascii=False))
    report = {"pass": not failed, "failed": failed, "pages": out}
    Path("/tmp/radial-live-browser-probe.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"pass": report["pass"], "failed": failed}, indent=2))
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
