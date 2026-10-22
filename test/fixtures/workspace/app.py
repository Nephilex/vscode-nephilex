import subprocess, hashlib, os
AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
def run(cmd):
    subprocess.run(cmd, shell=True)
def h(x):
    return hashlib.md5(x).hexdigest()
def q(cur, uid):
    cur.execute("SELECT * FROM users WHERE id = " + uid)
import yaml
def l(s):
    return yaml.load(s)
