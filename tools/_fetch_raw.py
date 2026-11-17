"""从生成日志里取出 GLB 与预览图并下载到 models/_raw/。

用法: python3 tools/_fetch_raw.py <名字> <日志路径>
"""
import json
import os
import re
import sys
import urllib.request

name = sys.argv[1]
log = sys.argv[2]
raw = open(log, encoding='utf-8', errors='replace').read()

start = raw.rfind('{\n  "job_id"')
if start < 0:
    start = raw.find('{')
try:
    data = json.loads(raw[start:])
except Exception as e:
    print('FAIL parse', name, e)
    sys.exit(1)

files = (data.get('raw_result') or {}).get('ResultFile3Ds') or []
glb = next((f for f in files if f['Type'] == 'GLB'), None)
if not glb:
    print('FAIL no GLB', name, (data.get('raw_result') or {}).get('ErrorMessage'))
    sys.exit(1)

out_dir = os.path.dirname(log)
out = os.path.join(out_dir, name + '.glb')
urllib.request.urlretrieve(glb['Url'], out)
print('OK', name, round(os.path.getsize(out) / 1048576, 2), 'MB')

pv = glb.get('PreviewImageUrl')
if pv:
    try:
        urllib.request.urlretrieve(pv, os.path.join(out_dir, name + '_preview.png'))
        print('   preview saved')
    except Exception as e:
        print('   preview failed', e)
