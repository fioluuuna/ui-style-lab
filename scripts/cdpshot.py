#!/usr/bin/env python3
"""把 CDP 返回的图片存成文件。

CDP 返回值超过约 25k 字符时，工具会把 JSON 存成文件；这个脚本从里面取出图片：
- Page.captureScreenshot 的 {"data": "<base64>"}
- Runtime.evaluate 返回的 dataURL：{"result": {"value": "data:image/...;base64,..."}}
- 返回对象时用 --key 指定字段：{"result": {"value": {"url": "data:..."}}}

用法：python3 cdpshot.py <cdp.json> <out.jpg|png|webp> [--key url]
"""
import base64
import json
import sys


def main():
    args = sys.argv[1:]
    key = None
    if '--key' in args:
        i = args.index('--key')
        key = args[i + 1]
        del args[i:i + 2]
    if len(args) != 2:
        sys.exit(__doc__)
    src, out = args
    d = json.load(open(src, encoding='utf-8'))
    v = d.get('data') or d.get('result', {}).get('value', '')
    if isinstance(v, dict):
        if not key:
            sys.exit('返回值是对象，用 --key 指定图片字段：' + ', '.join(v.keys()))
        v = v[key]
    if not isinstance(v, str) or not v:
        sys.exit('没有找到图片数据')
    if v.startswith('data:'):
        v = v.split(',', 1)[1]
    with open(out, 'wb') as f:
        f.write(base64.b64decode(v))
    print(out)


if __name__ == '__main__':
    main()
