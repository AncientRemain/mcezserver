// Samples CPU and memory of a running process.
// On Windows a single long-lived PowerShell loop is used (wmic no longer ships with Windows 11).
const os = require('os');
const { spawn, execFile } = require('child_process');

class ProcessMonitor {
  constructor(pid, onSample, intervalMs = 2000) {
    this.pid = pid;
    this.onSample = onSample;
    this.cores = os.cpus().length || 1;
    this.last = null;
    if (process.platform === 'win32') this._startWindows(intervalMs);
    else this._startPosix(intervalMs);
  }

  _emit(cpuMs, memBytes) {
    const now = Date.now();
    if (this.last) {
      const wall = now - this.last.t;
      const cpu = wall > 0 ? Math.max(0, ((cpuMs - this.last.cpu) / wall / this.cores) * 100) : 0;
      this.onSample({ cpu: Math.min(100, cpu), mem: memBytes });
    } else {
      this.onSample({ cpu: 0, mem: memBytes });
    }
    this.last = { t: now, cpu: cpuMs };
  }

  _startWindows(intervalMs) {
    const script =
      `$id=${Number(this.pid)}; while($true){ $p=Get-Process -Id $id -ErrorAction SilentlyContinue; if(-not $p){break}; ` +
      `[Console]::Out.WriteLine(([string][long]$p.TotalProcessorTime.TotalMilliseconds) + ' ' + [string]$p.WorkingSet64); ` +
      `[Console]::Out.Flush(); Start-Sleep -Milliseconds ${intervalMs} }`;
    this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const [cpu, mem] = line.split(' ').map(Number);
        if (Number.isFinite(cpu) && Number.isFinite(mem)) this._emit(cpu, mem);
      }
    });
    this.child.on('error', () => {});
  }

  _startPosix(intervalMs) {
    const tick = () => {
      execFile('ps', ['-o', 'cputime=,rss=', '-p', String(this.pid)], (err, out) => {
        if (err || !out.trim()) return;
        const [time, rss] = out.trim().split(/\s+/);
        const parts = time.split(/[-:]/).map(Number).reverse();
        const secs = (parts[0] || 0) + (parts[1] || 0) * 60 + (parts[2] || 0) * 3600 + (parts[3] || 0) * 86400;
        this._emit(secs * 1000, Number(rss) * 1024);
      });
    };
    tick();
    this.timer = setInterval(tick, intervalMs);
  }

  stop() {
    if (this.child) { try { this.child.kill(); } catch {} }
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = { ProcessMonitor };
