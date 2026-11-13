import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

WRAPPER = Path(__file__).with_name('run-cron.py')

class CronTests(unittest.TestCase):
    def test_timeout_terminates_descendant_even_if_parent_exits_on_term(self):
        with tempfile.TemporaryDirectory() as directory:
            pidfile = Path(directory) / 'child.pid'
            script = "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)']); open(sys.argv[1],'w').write(str(p.pid)); time.sleep(60)"
            result = subprocess.run([sys.executable,str(WRAPPER),'--lock',directory+'/job.lock','--timeout','0.5','--grace','0.2','--',sys.executable,'-c',script,str(pidfile)],timeout=5)
            self.assertEqual(result.returncode,124)
            pid = int(pidfile.read_text())
            # A killed orphan can briefly remain a zombie until its reaper runs.
            state = subprocess.run(['ps','-o','stat=','-p',str(pid)],capture_output=True,text=True).stdout.strip()
            self.assertTrue(not state or state.startswith('Z'), state)
            self.assertEqual(subprocess.run([sys.executable,str(WRAPPER),'--lock',directory+'/job.lock','--timeout','1','--','true']).returncode,0)

    def test_termination_cleans_group_and_releases_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            marker=Path(directory)/'started'
            script="import sys,time; open(sys.argv[1],'w').write('ready'); time.sleep(60)"
            proc=subprocess.Popen([sys.executable,str(WRAPPER),'--lock',directory+'/job.lock','--timeout','30','--grace','0.2','--',sys.executable,'-c',script,str(marker)])
            try:
                deadline=time.monotonic()+3
                while not marker.exists() and time.monotonic()<deadline: time.sleep(0.02)
                self.assertTrue(marker.exists())
                proc.terminate()
                self.assertEqual(proc.wait(timeout=3),143)
                self.assertEqual(subprocess.run([sys.executable,str(WRAPPER),'--lock',directory+'/job.lock','--timeout','1','--','true']).returncode,0)
            finally:
                if proc.poll() is None: proc.kill();proc.wait()

    def test_symlink_lock_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'target';target.write_text('unchanged')
            lock=Path(directory)/'lock';lock.symlink_to(target)
            result=subprocess.run([sys.executable,str(WRAPPER),'--lock',str(lock),'--timeout','1','--','true'])
            self.assertEqual(result.returncode,125)
            self.assertEqual(target.read_text(),'unchanged')

if __name__=='__main__': unittest.main()
