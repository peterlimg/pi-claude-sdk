// Test-only JSONL driver: owned Pi processes, raw dialog responses and explicit crash boundaries.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export class RpcWorker extends EventEmitter {
  constructor(file, cwd, options = {}) {
    super(); this.pending = new Map(); this.stderr = '';
    this.process = spawn(options.bin || 'pi', [...(options.prefix || []), '--mode', 'rpc', '--session', file],
      { cwd, env: { ...process.env, PI_REMOTE_WORKER: '0' }, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    this.exited = new Promise(resolve => this.process.once('close', resolve));
    this.process.stdin.on('error', () => {});
    const decoder = new StringDecoder('utf8'); let buffer = '';
    const stop = error => {
      if (this.failure) return;
      this.failure = error; this.fail(error); void this.close();
    };
    this.process.stdout.on('data', chunk => {
      if (this.failure) return;
      try {
        buffer += decoder.write(chunk);
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
          if (line.length > 8 * 1024 * 1024) throw new Error('Fixture RPC record too large');
          if (!line.trim()) continue;
          const value = JSON.parse(line);
          if (!value || Array.isArray(value) || typeof value.type !== 'string') throw new Error('Invalid fixture RPC event');
          if (value.type === 'response' && this.pending.has(value.id)) {
            const item = this.pending.get(value.id); this.pending.delete(value.id); clearTimeout(item.timer);
            if (value.success) item.resolve(value.data); else item.reject(new Error(value.error || 'Pi command failed'));
          } else this.emit('event', value);
        }
        if (buffer.length > 8 * 1024 * 1024) throw new Error('Fixture RPC record too large');
      } catch (error) { stop(error); }
    });
    this.process.stdout.on('end', () => {
      if (!this.failure && (buffer || decoder.end())) stop(new Error('Incomplete fixture RPC record'));
    });
    this.process.stderr.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-2000); });
    this.process.on('error', stop);
    this.process.on('close', (code, signal) => {
      this.closed = true;
      if (!this.failure) this.fail(new Error(`Pi worker exited (${signal || 'code ' + code})` + (this.stderr ? ': ' + this.stderr : '')));
      this.emit('exit');
    });
  }
  fail(error) {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear(); this.emit('fault', error);
  }
  request(type, data = {}, { background = false } = {}) {
    if (this.closed) return Promise.reject(new Error('Pi worker is closed'));
    if (this.failure) return Promise.reject(this.failure);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = background ? undefined : setTimeout(() => { this.pending.delete(id); reject(new Error('Pi response timed out; delivery may have occurred')); }, 30000);
      this.pending.set(id, { timer, resolve, reject: background ? error => this.emit('fault', error) : reject });
      this.process.stdin.write(JSON.stringify({ ...data, id, type }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
        else if (background) resolve();
      });
    });
  }
  async command(command) {
    if (command.type === 'abort') { await this.request('clear_queue'); await this.request('abort'); }
    else if (command.type === 'setModel') await this.request('set_model', { provider: command.provider, modelId: command.modelId });
    else if (command.type === 'prompt') {
      const { commands } = await this.request('get_commands');
      const background = commands.some(item => item.source === 'extension' && item.name === command.text.slice(1).split(' ', 1)[0]);
      await this.request('prompt', { message: command.text, streamingBehavior: 'steer' }, { background });
    } else throw new Error('Unsupported fixture command: ' + command.type);
    return { accepted: true };
  }
  async close() {
    if (this.closed) return;
    this.process.kill('SIGTERM');
    const timer = setTimeout(() => this.process.kill('SIGKILL'), 4000);
    await this.exited; clearTimeout(timer);
  }
}
