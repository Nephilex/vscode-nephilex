import sqlite3
from flask import Flask, request

app = Flask(__name__)


@app.route("/user")
def user():
    uid = request.args.get("id")
    query = "SELECT * FROM users WHERE id = '" + uid + "'"
    conn = sqlite3.connect("app.db")
    cur = conn.cursor()
    cur.execute(query)
    return str(cur.fetchall())
