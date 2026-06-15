"""
台账地址自动匹配服务端
连接本地 PostgreSQL，利用 pg_trgm 模糊匹配房屋地址，返回 pfhouseid。
"""

import os
import uuid
import threading
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg

# ============================================
# 数据库配置
# ============================================
DB_CONFIG = {
    'host': os.environ.get('DB_HOST', '127.0.0.1'),
    'port': int(os.environ.get('DB_PORT', 5432)),
    'dbname': os.environ.get('DB_NAME', 'postgres'),
    'user': os.environ.get('DB_USER', 'postgres'),
    'password': os.environ.get('DB_PASSWORD', '135086'),
}

TABLE_NAME = '北京市400万房屋底账'

# ============================================
# Flask 应用
# ============================================
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# 内存任务存储
# { task_id: { status, total, processed, matched, unmatched, results, error, created_at } }
tasks = {}
tasks_lock = threading.Lock()


def get_db_connection():
    """获取数据库连接"""
    return psycopg.connect(
        host=DB_CONFIG['host'],
        port=DB_CONFIG['port'],
        dbname=DB_CONFIG['dbname'],
        user=DB_CONFIG['user'],
        password=DB_CONFIG['password'],
        connect_timeout=10,
    )


def ensure_index():
    """确保 pg_trgm 扩展和 GIN 索引存在"""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
            cur.execute(
                f'CREATE INDEX IF NOT EXISTS idx_address_trgm ON "{TABLE_NAME}" '
                f'USING GIN (adress gin_trgm_ops);'
            )
            conn.commit()
    print('[数据库] pg_trgm 扩展与索引已就绪')


def run_match_task(task_id: str, addresses: list):
    """后台执行批量地址匹配"""
    with tasks_lock:
        tasks[task_id]['status'] = 'running'

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                for idx, item in enumerate(addresses):
                    address = item.get('address', '') or ''
                    result = {
                        'id': item.get('id'),
                        'address': address,
                        'matched': False,
                        'pfhouseid': None,
                        'matched_address': None,
                        'similarity': 0,
                    }

                    if address.strip():
                        cur.execute(
                            f'SELECT *, similarity(adress, %s) AS sim '
                            f'FROM "{TABLE_NAME}" '
                            f'WHERE adress %% %s '
                            f'ORDER BY sim DESC LIMIT 1;',
                            (address, address)
                        )
                        row = cur.fetchone()
                        if row:
                            attributes = {
                                d.name: row[i]
                                for i, d in enumerate(cur.description)
                                if d.name != 'sim'
                            }
                            result['matched'] = True
                            result['pfhouseid'] = attributes.get('pfhouseid')
                            result['matched_address'] = attributes.get('adress')
                            result['similarity'] = float(row[-1])
                            result['attributes'] = attributes

                    with tasks_lock:
                        tasks[task_id]['results'].append(result)
                        tasks[task_id]['processed'] = idx + 1
                        if result['matched']:
                            tasks[task_id]['matched'] += 1
                        else:
                            tasks[task_id]['unmatched'] += 1

        with tasks_lock:
            tasks[task_id]['status'] = 'completed'
    except Exception as e:
        with tasks_lock:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['error'] = str(e)
        print(f'[匹配任务 {task_id}] 失败: {e}')


@app.route('/api/health', methods=['GET'])
def health():
    """健康检查"""
    return jsonify({'status': 'ok', 'time': datetime.now().isoformat()})


@app.route('/api/match', methods=['POST'])
def start_match():
    """启动批量匹配任务"""
    data = request.get_json(force=True) or {}
    addresses = data.get('addresses', [])

    if not isinstance(addresses, list) or len(addresses) == 0:
        return jsonify({'error': 'addresses 不能为空数组'}), 400

    task_id = str(uuid.uuid4())
    with tasks_lock:
        tasks[task_id] = {
            'status': 'pending',
            'total': len(addresses),
            'processed': 0,
            'matched': 0,
            'unmatched': 0,
            'results': [],
            'error': None,
            'created_at': datetime.now().isoformat(),
        }

    thread = threading.Thread(target=run_match_task, args=(task_id, addresses), daemon=True)
    thread.start()

    return jsonify({'task_id': task_id, 'total': len(addresses)})


@app.route('/api/match/<task_id>', methods=['GET'])
def get_match_status(task_id: str):
    """查询匹配任务进度与结果"""
    with tasks_lock:
        task = tasks.get(task_id)

    if not task:
        return jsonify({'error': '任务不存在'}), 404

    return jsonify({
        'task_id': task_id,
        'status': task['status'],
        'total': task['total'],
        'processed': task['processed'],
        'matched': task['matched'],
        'unmatched': task['unmatched'],
        'progress': round(task['processed'] / task['total'] * 100, 2) if task['total'] > 0 else 0,
        'error': task['error'],
        'results': task['results'],
    })


if __name__ == '__main__':
    print('[启动] 正在检查数据库索引...')
    try:
        ensure_index()
    except Exception as e:
        print(f'[警告] 数据库索引检查失败: {e}')
        print('[提示] 请确认 PostgreSQL 服务已启动且连接信息正确')

    print('[启动] 服务运行在 http://127.0.0.1:5000')
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
