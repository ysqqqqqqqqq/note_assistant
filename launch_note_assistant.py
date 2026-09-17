"""Double-click launcher for the local Note Assistant web app."""

import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent / "note_assistant - git"
PORT = os.environ.get("PORT", "5000")
URL = f"http://127.0.0.1:{PORT}/"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def service_status():
    try:
        with OPENER.open(URL, timeout=1) as response:
            page = response.read(300_000)
    except urllib.error.HTTPError:
        return "occupied"
    except (urllib.error.URLError, TimeoutError, OSError):
        return "offline"
    return "note-assistant" if b'id="voice-open"' in page else "occupied"


def main():
    if not (APP_DIR / "server.py").is_file():
        print("找不到 Note Assistant 服务文件，请把快捷入口留在项目外层文件夹。")
        return 1

    status = service_status()
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        print(f"{URL}：{status}")
        return 0

    if status == "note-assistant":
        print(f"Note Assistant 已在运行，正在打开网页：{URL}")
        if not webbrowser.open(URL):
            print("浏览器未自动打开，请手动访问上方地址。")
        return 0
    if status == "occupied":
        print(f"端口 {PORT} 已被其他服务占用，无法启动 Note Assistant。")
        return 1

    print("正在启动 Note Assistant，请稍候……")
    try:
        process = subprocess.Popen([sys.executable, "server.py"], cwd=APP_DIR)
    except OSError as exc:
        print(f"启动失败：{exc}")
        return 1

    for _ in range(40):
        if process.poll() is not None:
            print("服务启动失败。请检查窗口上方的错误信息和依赖安装情况。")
            return 1
        status = service_status()
        if status == "note-assistant":
            print(f"已启动：{URL}\n请保持此窗口开启；按 Ctrl+C 可停止服务。")
            if not webbrowser.open(URL):
                print("浏览器未自动打开，请手动访问上方地址。")
            break
        if status == "occupied":
            process.terminate()
            print(f"端口 {PORT} 被其他服务占用，无法打开 Note Assistant。")
            return 1
        time.sleep(0.5)
    else:
        process.terminate()
        print("等待服务启动超时。请检查窗口上方的错误信息。")
        return 1

    try:
        process.wait()
    except KeyboardInterrupt:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
