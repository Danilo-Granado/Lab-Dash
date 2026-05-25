"""
app.py
------
Flask entry point. Registers blueprints and starts the dev server.
SSE (Server-Sent Events) is used for live equipment streaming — no extra
libraries needed, works natively in every modern browser.
"""

from flask import Flask
from routes.api import api_bp
from routes.stream import stream_bp
from routes.storage import storage_bp

def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["SECRET_KEY"] = "lab-dashboard-dev"

    app.register_blueprint(api_bp,     url_prefix="/api")
    app.register_blueprint(stream_bp,  url_prefix="/stream")
    app.register_blueprint(storage_bp, url_prefix="/storage")

    # Serve the main SPA shell
    from flask import render_template
    @app.route("/")
    def index():
        return render_template("index.html")

    return app


if __name__ == "__main__":
    app = create_app()
    # threaded=True is required — each SSE stream holds a long-lived connection
    app.run(debug=True, threaded=True, port=5000)
