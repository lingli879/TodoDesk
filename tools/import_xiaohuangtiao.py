# 一次性导入：小黄条 xlsx 导出 → TodoDesk data.json。
# 映射：内容→title，描述→notes，开始时间→startTime（空则用创建时间），
# 结束时间→dueTime，状态=已完成且完成时间有效→endTime；已删除跳过。
# 用法：python tools/import_xiaohuangtiao.py <xlsx路径>
import json
import shutil
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl

DATA = Path(__file__).resolve().parent.parent / 'data' / 'data.json'
BACKUP = DATA.with_suffix('.json.import-bak-20260928')
EPOCH_HOAX = datetime(2000, 1, 1)  # 小黄条用 1970-01-01 表示"无完成时间"


TZ_CN = timezone(timedelta(hours=8))  # 中国无夏令时；显式 tzinfo 走纯算术，避开 Windows localtime 对 1970 伪值 报错


def to_iso(s):
    s = (s or '').strip()
    if not s:
        return None
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M'):
        try:
            # naive 本地时间 → UTC ISO（与 TodoDesk 存储格式一致）
            return datetime.strptime(s, fmt).replace(tzinfo=TZ_CN) \
                .astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
        except ValueError:
            continue
    raise ValueError(f'无法解析时间: {s!r}')


def main(xlsx):
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    header = list(rows[0])
    col = {name: i for i, name in enumerate(header)}

    data = json.loads(DATA.read_text(encoding='utf-8'))
    shutil.copyfile(DATA, BACKUP)
    print(f'已备份原库 → {BACKUP.name}')

    work = next((c for c in data['categories'] if c['name'] == '工作'), None)
    if work is None:
        raise SystemExit('data.json 中不存在「工作」分类')
    now_iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    sort = max((t.get('sortOrder', -1) for t in data['todos']), default=-1) + 1

    imported, skipped = [], []
    for r in rows[1:]:
        status = str(r[col['状态']] or '').strip()
        title = str(r[col['内容']] or '').strip()
        if status == '已删除':
            skipped.append(f'已删除: {title[:20]}')
            continue
        if not title:
            skipped.append('空内容行')
            continue
        created = to_iso(r[col['创建时间']])
        finished = to_iso(r[col['完成时间']])
        real_finish = bool(finished) and datetime.strptime(
            r[col['完成时间']].strip(), '%Y-%m-%d %H:%M:%S') >= EPOCH_HOAX \
            if finished else False
        imported.append({
            'id': str(uuid.uuid4()),
            'title': title,
            'notes': str(r[col['描述']] or ''),
            'categoryId': work['id'],
            'startTime': to_iso(r[col['开始时间']]) or created,
            'endTime': finished if (status == '已完成' and real_finish) else None,
            'dueTime': to_iso(r[col['结束时间']]),
            'createdAt': created,
            'updatedAt': to_iso(r[col['编辑时间']]) or created,
            'endTimeManuallySet': status == '已完成',
            'sortOrder': sort,
        })
        sort += 1

    data['todos'].extend(imported)
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'导入 {len(imported)} 条，跳过 {len(skipped)} 条')
    for s in skipped:
        print(f'  跳过: {s}')
    done = sum(1 for t in imported if t['endTime'])
    print(f'其中已完成 {done} 条、未完成 {len(imported) - done} 条，全部归入「工作」')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\dev\Desktop\小黄条导出20260928.xlsx')
