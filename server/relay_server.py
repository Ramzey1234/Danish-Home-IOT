#!/usr/bin/env python3
"""
ESP32 Smart Home Relay Server — Multi-Node Support
- Connect unlimited ESP32 boards simultaneously (e.g. Living Room, Bedroom, Sensor Node, Garden)
- Real-time bidirectional message routing
- Auto device discovery & heartbeat
"""

import os
import json
import tornado.ioloop
import tornado.web
import tornado.websocket

PORT = int(os.environ.get("PORT", 8888))
DASHBOARD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SECRET_TOKEN = os.environ.get("ESP32_TOKEN", "my-secret-esp32-token")

dashboard_clients = set()
# Map device_id -> {"ws": WebSocketHandler, "ip": str, "name": str}
esp32_nodes = {}

device_state = {
    "sensors": {},
    "devices": {}
}

def get_nodes_list():
    """Returns an array of currently connected ESP32 nodes."""
    return [
        {"id": node_id, "ip": info["ip"], "name": info.get("name", node_id)}
        for node_id, info in esp32_nodes.items()
    ]

def broadcast_nodes_status():
    """Sends current list of online ESP32s to all web dashboards."""
    nodes = get_nodes_list()
    msg = json.dumps({
        "type": "nodes_status",
        "count": len(nodes),
        "nodes": nodes,
        "connected": len(nodes) > 0
    })
    for client in list(dashboard_clients):
        try:
            client.write_message(msg)
        except Exception:
            dashboard_clients.discard(client)

class WebSocketHandler(tornado.websocket.WebSocketHandler):
    def check_origin(self, origin):
        return True

    def open(self):
        self.role = self.get_argument("role", "dashboard")
        self.token = self.get_argument("token", "")
        self.device_id = self.get_argument("device_id", "esp32_main")
        self.device_name = self.get_argument("name", self.device_id)

        if self.role == "esp32":
            if self.token != SECRET_TOKEN:
                print(f"[AUTH FAILED] ESP32 ({self.device_id}) rejected from {self.request.remote_ip}")
                self.close(4001, "Invalid Token")
                return

            # Register node
            esp32_nodes[self.device_id] = {
                "ws": self,
                "ip": self.request.remote_ip,
                "name": self.device_name
            }
            print(f"[ESP32] ✅ Node '{self.device_id}' ({self.device_name}) connected from {self.request.remote_ip} (Total ESP32s: {len(esp32_nodes)})")

            # Broadcast node list update
            broadcast_nodes_status()

            # Sync cached states to new node
            if device_state["devices"]:
                self.write_message(json.dumps({"type": "sync", "devices": device_state["devices"]}))

        else:
            dashboard_clients.add(self)
            print(f"[Dashboard] ✅ Connected from {self.request.remote_ip} (Total Dashboards: {len(dashboard_clients)})")

            # Send initial state + online ESP32 nodes
            self.write_message(json.dumps({
                "type": "init",
                "nodes": get_nodes_list(),
                "connected": len(esp32_nodes) > 0,
                "sensors": device_state["sensors"],
                "devices": device_state["devices"]
            }))

    def on_message(self, message):
        try:
            data = json.loads(message)
        except Exception:
            return

        if self.role == "esp32":
            # Sensor telemetry from any ESP32 node
            if data.get("type") == "sensor":
                s_name = data.get("sensor")
                if s_name:
                    device_state["sensors"][s_name] = data.get("value")

            # Tag message with source device_id
            data["node_id"] = self.device_id
            broadcast_msg = json.dumps(data)

            for client in list(dashboard_clients):
                try:
                    client.write_message(broadcast_msg)
                except Exception:
                    dashboard_clients.discard(client)

        elif self.role == "dashboard":
            if data.get("type") == "command" and data.get("topic"):
                device_state["devices"][data.get("topic")] = data

            # Route command to target ESP32 node or broadcast to all ESP32 nodes
            target_node = data.get("target_node")
            sent_count = 0

            if target_node and target_node in esp32_nodes:
                try:
                    esp32_nodes[target_node]["ws"].write_message(message)
                    sent_count += 1
                except Exception:
                    del esp32_nodes[target_node]
            else:
                # Broadcast to all connected ESP32s
                dead_nodes = []
                for node_id, node_info in esp32_nodes.items():
                    try:
                        node_info["ws"].write_message(message)
                        sent_count += 1
                    except Exception:
                        dead_nodes.append(node_id)
                for dn in dead_nodes:
                    del esp32_nodes[dn]
                if dead_nodes:
                    broadcast_nodes_status()

            if sent_count == 0:
                self.write_message(json.dumps({"type": "error", "message": "No ESP32 nodes connected"}))

            # Sync other open dashboard tabs
            for other in list(dashboard_clients):
                if other != self:
                    try:
                        other.write_message(message)
                    except Exception:
                        dashboard_clients.discard(other)

    def on_close(self):
        if getattr(self, "role", "") == "esp32":
            if getattr(self, "device_id", "") in esp32_nodes:
                del esp32_nodes[self.device_id]
                print(f"[ESP32] ❌ Node '{self.device_id}' disconnected (Remaining: {len(esp32_nodes)})")
                broadcast_nodes_status()
        else:
            dashboard_clients.discard(self)
            print(f"[Dashboard] ❌ Disconnected (Remaining: {len(dashboard_clients)})")

def make_app():
    return tornado.web.Application([
        (r"/ws", WebSocketHandler),
        (r"/(.*)", tornado.web.StaticFileHandler, {"path": DASHBOARD_DIR, "default_filename": "index.html"}),
    ], websocket_ping_interval=10, websocket_ping_timeout=30)

if __name__ == "__main__":
    app = make_app()
    app.listen(PORT, address="0.0.0.0")
    print("=" * 60)
    print(f"🚀 MULTI-NODE SMART HOME RELAY SERVER ACTIVE (PORT {PORT})")
    print(f"📡 Serving: http://0.0.0.0:{PORT}")
    print(f"🔌 Supports unlimited ESP32 nodes via: /ws?role=esp32&device_id=NAME")
    print("=" * 60)
    tornado.ioloop.IOLoop.current().start()
