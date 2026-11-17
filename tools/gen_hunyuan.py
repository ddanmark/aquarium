"""混元生3D 生成器：提交任务 → 轮询 → 下载 GLB 与预览图。

默认走 `ai3d.tencentcloudapi.com`（对应 console.cloud.tencent.com/ai3d/packages
里的积分包），用 SecretId + SecretKey 做 TC3-HMAC-SHA256 签名。
`--api=tokenhub` 保留旧的 Bearer Key 通道（HY3D_KEY）。

凭证不写进命令行：
  ai3d    : 环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY
            或 models/_raw/.ai3d_key（两行：SecretId=... / SecretKey=...）
  tokenhub: 环境变量 HY3D_KEY 或 models/_raw/.hy3d_key

用法:
  python3 tools/gen_hunyuan.py --list
  python3 tools/gen_hunyuan.py --estimate
  python3 tools/gen_hunyuan.py guppy [--faces 45000] [--no-pbr] [--model 3.1]
  python3 tools/gen_hunyuan.py <id> "自定义中文提示词"
  python3 tools/gen_hunyuan.py --query <JobId>
  python3 tools/gen_hunyuan.py --all [--budget 100]
"""
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'models', '_raw')

AI3D_HOST = 'ai3d.tencentcloudapi.com'
AI3D_SERVICE = 'ai3d'
AI3D_VERSION = '2025-05-13'
AI3D_REGION = 'ap-guangzhou'
TOKENHUB_BASE = 'https://tokenhub.tencentmaas.com/v1/api/3d'

# 每条都写死「身体平直对称、鱼鳍完全展开」，否则自动绑骨会算歪脊线、拆不开鳍骨权重
PROMPTS = {
    'guppy': (
        '写实孔雀鱼，雄性单条，体长约4厘米，身体细长半透明，尾鳍宽大呈扇形带彩色斑点，'
        '背鳍飘逸舒展，身体平直对称，所有鱼鳍完全展开，嘴唇闭合，纯色背景，'
        '单独一条鱼，无水面、无水草、无底砂、无底座'),
    'zebra': (
        '写实斑马鱼，单条，体长约4厘米，身体细长呈纺锤形，体侧有数条水平蓝黑色纵条纹，'
        '条纹从鳃盖一直延伸到尾柄，头部小、吻端略尖，尾鳍分叉、鳍膜透明，'
        '身体平直对称，所有鱼鳍完全展开，纯色背景，单独一条鱼，无水草、无底砂、无底座'),
    'blacktetra': (
        '写实黑尾大勾脂鲤（Moenkhausia costae），单条，体长约5厘米，银白色菱形侧扁体型，'
        '体侧一条明显黑色纵带从鳃盖延伸到尾柄，尾鳍分叉且尾鳍上下叶边缘为黑色，'
        '背鳍高、臀鳍较长，身体平直对称，所有鱼鳍完全展开，纯色背景，'
        '单独一条鱼，无水草、无底砂、无底座'),
    'molly': (
        '写实黑玛丽鱼（Poecilia sphenops），单条，体长约7厘米，通体乌黑无花纹，'
        '体型短粗饱满、背部隆起、腹部圆润，头部宽平、吻端略上翘，尾鳍宽大呈扇形、'
        '背鳍宽大舒展，身体平直对称，所有鱼鳍完全展开，纯色背景，'
        '单独一条鱼，无水草、无底砂、无底座'),
    'corydoras': (
        'Photorealistic 3D model of a single three-lined Corydoras catfish '
        '(Corydoras trilineatus), small freshwater bottom-dwelling armored catfish. '
        'Neutral straight swimming pose, body axis perfectly straight and symmetric, '
        'all fins fully extended and spread out, mouth closed with two pairs of short '
        'barbels. Pale silvery-tan body with fine dark reticulated mottling and three '
        'distinct dark longitudinal stripes running nose to tail, rows of bony scute '
        'plates along the flanks, small adipose fin, slightly forked caudal fin. '
        'Full body visible, clean silhouette, plain neutral background, no water, '
        'no plants, no gravel, no tank, no base, single object only.'),
}

# 与神仙鱼日志里的 ResultCreditDetails 一致：Normal 20 / Pbr 10 / FaceCount 10
COST_NORMAL = 20
COST_PBR = 10
COST_FACES = 10


def credits(pbr=True, faces=None):
    return COST_NORMAL + (COST_PBR if pbr else 0) + (COST_FACES if faces else 0)


def ai3d_creds():
    sid = os.environ.get('TENCENTCLOUD_SECRET_ID', '').strip()
    skey = os.environ.get('TENCENTCLOUD_SECRET_KEY', '').strip()
    if sid and skey:
        return sid, skey
    p = os.path.join(RAW, '.ai3d_key')
    if os.path.exists(p):
        kv = {}
        for line in open(p, encoding='utf-8'):
            if '=' in line:
                k, v = line.split('=', 1)
                kv[k.strip()] = v.strip()
        sid, skey = kv.get('SecretId', ''), kv.get('SecretKey', '')
        if sid and skey:
            return sid, skey
    raise SystemExit(
        '缺少 ai3d 凭证：设置 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY，'
        '或写入 models/_raw/.ai3d_key（SecretId=AKID... / SecretKey=...）')


def _sha256(msg):
    return hashlib.sha256(msg.encode('utf-8')).hexdigest()


def _hmac(key_bytes, msg):
    return hmac.new(key_bytes, msg.encode('utf-8'), hashlib.sha256).digest()


def ai3d_call(action, payload):
    """纯标准库实现 TC3-HMAC-SHA256，不依赖 tencentcloud-sdk-python。"""
    secret_id, secret_key = ai3d_creds()
    body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    ts = int(time.time())
    date = datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%d')

    canonical_headers = 'content-type:application/json; charset=utf-8\nhost:%s\n' % AI3D_HOST
    signed_headers = 'content-type;host'
    canonical_request = '\n'.join([
        'POST', '/', '', canonical_headers, signed_headers, _sha256(body.decode('utf-8'))
    ])
    scope = '%s/%s/tc3_request' % (date, AI3D_SERVICE)
    string_to_sign = '\n'.join([
        'TC3-HMAC-SHA256', str(ts), scope, _sha256(canonical_request)
    ])
    k_date = _hmac(('TC3' + secret_key).encode('utf-8'), date)
    k_service = _hmac(k_date, AI3D_SERVICE)
    k_signing = _hmac(k_service, 'tc3_request')
    signature = hmac.new(k_signing, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()
    authorization = ('TC3-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s'
                     % (secret_id, scope, signed_headers, signature))

    req = urllib.request.Request(
        'https://' + AI3D_HOST + '/',
        data=body,
        headers={
            'Authorization': authorization,
            'Content-Type': 'application/json; charset=utf-8',
            'Host': AI3D_HOST,
            'X-TC-Action': action,
            'X-TC-Timestamp': str(ts),
            'X-TC-Version': AI3D_VERSION,
            'X-TC-Region': AI3D_REGION,
        },
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise SystemExit('HTTP %d: %s' % (e.code, e.read().decode(errors='replace')[:600]))
    resp = out.get('Response', out)
    if 'Error' in resp:
        raise SystemExit('API 错误 %s: %s' % (resp['Error'].get('Code'),
                                             resp['Error'].get('Message')))
    return resp


def tokenhub_key():
    k = os.environ.get('HY3D_KEY')
    if k:
        return k.strip()
    p = os.path.join(RAW, '.hy3d_key')
    if os.path.exists(p):
        return open(p).read().strip()
    raise SystemExit('缺少 HY3D_KEY')


def tokenhub_call(path, payload):
    req = urllib.request.Request(
        TOKENHUB_BASE + path, data=json.dumps(payload).encode(),
        headers={'Authorization': 'Bearer ' + tokenhub_key(),
                 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit('HTTP %d: %s' % (e.code, e.read().decode(errors='replace')[:500]))


def download(url, dst):
    urllib.request.urlretrieve(url, dst)
    return dst


def fetch_result(files, sid):
    os.makedirs(RAW, exist_ok=True)
    got = None
    for item in files:
        if (item.get('Type') or '').upper() != 'GLB':
            continue
        url = item.get('Url')
        if not url:
            continue
        dst = os.path.join(RAW, sid + '.glb')
        download(url, dst)
        print('   glb  -> %s  %.1f MB' % (dst, os.path.getsize(dst) / 1048576))
        got = dst
        prev = item.get('PreviewImageUrl')
        if prev:
            try:
                download(prev, os.path.join(RAW, sid + '_preview.png'))
                print('   预览 -> %s' % os.path.join(RAW, sid + '_preview.png'))
            except Exception as e:
                print('   预览下载失败:', e)
        break
    if not got:
        raise SystemExit('结果里没有 GLB：' + json.dumps(files, ensure_ascii=False)[:500])
    print('\n下一步: python3 tools/ingest.py models/_raw/%s.glb %s' % (sid, sid))
    return got


def query_ai3d(job_id, sid):
    print('② 查询任务 %s' % job_id)
    t0 = time.time()
    while time.time() - t0 < 600:
        r = ai3d_call('QueryHunyuanTo3DProJob', {'JobId': job_id})
        st = r.get('Status')
        print('   %4ds  %s' % (int(time.time() - t0), st))
        if st == 'DONE':
            print('   消耗积分: %s  明细: %s' % (r.get('ResultCreditConsumed'),
                                              r.get('ResultCreditDetails')))
            return fetch_result(r.get('ResultFile3Ds') or [], sid)
        if st == 'FAIL':
            raise SystemExit('生成失败: %s %s' % (r.get('ErrorCode'),
                                                 r.get('ErrorMessage')))
        time.sleep(6)
    raise SystemExit('超时，JobId 保留 24 小时：%s（用 --query 续查）' % job_id)


def run_one(sid, prompt, api, faces, pbr, model):
    if api == 'ai3d':
        payload = {'Model': model, 'Prompt': prompt, 'GenerateType': 'Normal',
                   'EnablePBR': bool(pbr)}
        if faces:
            payload['FaceCount'] = faces
        print('① 提交 %s  Model=%s  PBR=%s  面数=%s  预计 %d 积分'
              % (sid, model, pbr, faces, credits(pbr, faces)))
        r = ai3d_call('SubmitHunyuanTo3DProJob', payload)
        jid = r.get('JobId')
        if not jid:
            raise SystemExit('提交失败: ' + json.dumps(r, ensure_ascii=False)[:400])
        print('   JobId=%s' % jid)
        return query_ai3d(jid, sid)

    m = 'hy-3d-3.1' if model == '3.1' else model
    print('① 提交（TokenHub）%s / %s' % (sid, m))
    r = tokenhub_call('/submit', {
        'model': m, 'prompt': prompt, 'enable_pbr': bool(pbr),
        'face_count': faces or 40000, 'generate_type': 'Normal',
        'result_format': 'glb'})
    jid = r.get('id')
    if not jid:
        raise SystemExit('提交失败: ' + json.dumps(r, ensure_ascii=False)[:400])
    t0 = time.time()
    while time.time() - t0 < 480:
        time.sleep(6)
        q = tokenhub_call('/query', {'model': m, 'id': jid})
        st = q.get('status')
        print('   %4ds  %s' % (int(time.time() - t0), st))
        if st == 'completed':
            return fetch_result(
                [{'Type': i.get('type'), 'Url': i.get('url'),
                  'PreviewImageUrl': i.get('preview_image_url')}
                 for i in (q.get('data') or [])], sid)
        if st == 'failed':
            raise SystemExit('生成失败: ' + json.dumps(q, ensure_ascii=False)[:400])
    raise SystemExit('超时，任务 id 保留：' + jid)


def main():
    argv = sys.argv[1:]
    opts = {}
    pos = []
    for a in argv:
        if a.startswith('--'):
            if '=' in a:
                k, v = a[2:].split('=', 1)
                opts[k] = v
            else:
                opts[a[2:]] = True
        else:
            pos.append(a)

    if 'list' in opts:
        for k, v in PROMPTS.items():
            print('%-12s %s' % (k, v[:70] + '...'))
        return
    if 'estimate' in opts:
        for label, pbr, faces in [('Normal 无 PBR 默认面数', False, None),
                                  ('Normal + PBR 默认面数', True, None),
                                  ('Normal + PBR + 自定义面数', True, 45000)]:
            c = credits(pbr, faces)
            print('%-30s %2d 积分/条   100 积分可做 %d 条' % (label, c, 100 // c))
        return

    api = opts.get('api', 'ai3d')
    faces = int(opts.get('faces', 45000))
    pbr = 'no-pbr' not in opts
    model = opts.get('model', '3.1')

    if 'query' in opts:
        query_ai3d(str(opts['query']), pos[0] if pos else 'manual')
        return

    if 'all' in opts:
        budget = int(opts.get('budget', 100))
        ids = ['guppy', 'zebra', 'blacktetra', 'molly']
        cost = credits(pbr, faces)
        n = min(len(ids), budget // cost)
        if n == 0:
            raise SystemExit('预算 %d 积分不够跑一条（%d/条），可加 --no-pbr 或去掉 --faces' % (budget, cost))
        print('预算 %d 积分，%d 积分/条，本次提交 %d 条：%s'
              % (budget, cost, n, ', '.join(ids[:n])))
        if n < len(ids):
            print('   剩余 %s 本次不提交（并发上限 3，积分不足）' % ', '.join(ids[n:]))
        for sid in ids[:n]:
            run_one(sid, PROMPTS[sid], api, faces, pbr, model)
        return

    if not pos:
        print(__doc__)
        raise SystemExit(1)
    sid = pos[0]
    prompt = pos[1] if len(pos) > 1 else PROMPTS.get(sid)
    if not prompt:
        raise SystemExit('未知品种 %s，用 --list 查看内置提示词，或直接传第二个参数' % sid)
    run_one(sid, prompt, api, faces, pbr, model)


if __name__ == '__main__':
    main()
