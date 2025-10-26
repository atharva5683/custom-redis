const net = require("net");
const fs = require("fs");
const path = require("path");
const Parser = require("redis-parser");

const DATA_FILE = path.join(__dirname, "redis_data.json");

let store = {};
let expiryTimes = {};

if (fs.existsSync(DATA_FILE)) {
  try {
    const fileData = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    store = fileData.store || {};
    expiryTimes = fileData.expiryTimes || {};
    console.log("Data loaded from file.");
  } catch (err) {
    console.error("Error loading data file:", err);
  }
}

function saveToFile() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ store, expiryTimes }, null, 2));
}

function checkExpiry() {
  const now = Date.now();
  for (const key in expiryTimes) {
    if (now > expiryTimes[key]) {
      delete store[key];
      delete expiryTimes[key];
    }
  }
  saveToFile();
}

// Run expiry check every 5 seconds
setInterval(checkExpiry, 5000);

const server = net.createServer((connection) => {
  console.log("Client connected");

  connection.on("data", (data) => {
    const parser = new Parser({
      returnReply: (reply) => {
        const command = reply[0].toLowerCase();

        switch (command) {
          // SET key value
          case "set": {
            const key = reply[1];
            let value = reply[2];

            if (
              typeof value === "string" &&
              (value.trim().startsWith("{") || value.trim().startsWith("["))
            ) {
              try {
                value = JSON.parse(value);
              } catch (e) {}
            }

            store[key] = value;
            delete expiryTimes[key];
            saveToFile();
            connection.write("+OK\r\n");
            break;
          }

          case "setex": {
            const key = reply[1];
            const seconds = parseInt(reply[2]);
            let value = reply[3];

            if (
              typeof value === "string" &&
              (value.trim().startsWith("{") || value.trim().startsWith("["))
            ) {
              try {
                value = JSON.parse(value);
              } catch (e) {}
            }

            store[key] = value;
            expiryTimes[key] = Date.now() + seconds * 1000;
            saveToFile();
            connection.write("+OK\r\n");
            break;
          }

          // GET key
          case "get": {
            const key = reply[1];

            if (expiryTimes[key] && Date.now() > expiryTimes[key]) {
              delete store[key];
              delete expiryTimes[key];
              saveToFile();
            }

            const value = store[key];
            if (value === undefined) {
              connection.write("$-1\r\n");
            } else {
              let output;

              if (typeof value === "object") {
                output = JSON.stringify(value, null, 2);
              } else {
                output = String(value);
              }
              const byteLength = Buffer.byteLength(output, "utf8");
              connection.write(`$${byteLength}\r\n${output}\r\n`);
            }
            break;
          }

          // DEL key
          case "del": {
            const key = reply[1];
            const deleted = delete store[key];
            delete expiryTimes[key];
            saveToFile();
            connection.write(`:${deleted ? 1 : 0}\r\n`);
            break;
          }

          // KEYS
          case "keys": {
            const keys = Object.keys(store);
            const response =
              `*${keys.length}\r\n` +
              keys.map((k) => `$${k.length}\r\n${k}\r\n`).join("");
            connection.write(response);
            break;
          }

          // FLUSHALL
          case "flushall": {
            store = {};
            expiryTimes = {};
            saveToFile();
            connection.write("+OK\r\n");
            break;
          }

          default:
            connection.write(`-ERR unknown command '${command}'\r\n`);
        }
      },

      returnError: (err) => {
        console.error(" Parser Error:", err);
      },
    });

    parser.execute(data);
  });

  connection.on("end", () => console.log("Client disconnected"));
});

server.listen(6379, () =>
  console.log(" Custom Redis Server running on port 6379")
);
