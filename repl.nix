run = "node server.js"
entrypoint = "server.js"

[nix]
channel = "stable-22_11"

[env]
PORT = "3000"
NODE_ENV = "production"
