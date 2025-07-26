import { WebSocketServer, WebSocket } from "ws";

// Extend WebSocket to include roomId
interface Client extends WebSocket {
  roomId?: string;
}

interface Message {
  type: string;
  roomId?: string;
  content?: string;
  sender?: string;
  userCount?: number;
}

// Store clients by room ID
const rooms: { [roomId: string]: Set<Client> } = {};
// Store room metadata (for rooms that exist but may have no active connections)
const roomMetadata: { [roomId: string]: { created: Date, lastActivity: Date } } = {};

// Generate short room code (6 characters)
const generateShortCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (socket: Client) => {
  console.log("New client connected");

  socket.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (!message || typeof message !== "object") {
        throw new Error("Invalid message format");
      }

      switch (message.type) {
        case "create-room":
          const { roomId: customRoomId } = message;
          let newRoomId;
          
          if (customRoomId && typeof customRoomId === "string") {
            // Use provided room ID (for when room is pre-created on frontend)
            newRoomId = customRoomId.toUpperCase();
          } else {
            // Generate new room ID
            newRoomId = generateShortCode();
            // Ensure room ID is unique
            while (rooms[newRoomId] || roomMetadata[newRoomId]) {
              newRoomId = generateShortCode();
            }
          }
          
          // Create room if it doesn't exist
          if (!rooms[newRoomId]) {
            rooms[newRoomId] = new Set();
          }
          
          // Add metadata
          roomMetadata[newRoomId] = {
            created: new Date(),
            lastActivity: new Date()
          };
          
          rooms[newRoomId].add(socket);
          socket.roomId = newRoomId;
          
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ 
              type: "room-created", 
              roomId: newRoomId,
              userCount: rooms[newRoomId].size
            }));
          } else {
            console.error("Socket closed before sending room-created");
          }
          console.log(`Room created: ${newRoomId}, Clients: ${rooms[newRoomId].size}`);
          break;

        case "join-room":
          const { roomId: joinRoomId } = message;
          if (typeof joinRoomId !== "string" || !joinRoomId) {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ 
                type: "error", 
                message: "Invalid room code" 
              }));
            }
            console.log("Invalid roomId provided:", joinRoomId);
            break;
          }
          
          const upperRoomId = joinRoomId.toUpperCase();
          
          // Check if room exists (either has active connections or metadata)
          if (rooms[upperRoomId] || roomMetadata[upperRoomId]) {
            // Create room set if it doesn't exist (room was pre-created)
            if (!rooms[upperRoomId]) {
              rooms[upperRoomId] = new Set();
            }
            
            rooms[upperRoomId].add(socket);
            socket.roomId = upperRoomId;
            
            // Update metadata
            if (roomMetadata[upperRoomId]) {
              roomMetadata[upperRoomId].lastActivity = new Date();
            }
            
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ 
                type: "joined-room", 
                roomId: upperRoomId 
              }));
            }
            
            // Notify all clients in room about user count update
            rooms[upperRoomId].forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: "user-count-update",
                  userCount: rooms[upperRoomId].size
                }));
              }
            });
            
            console.log(`Client joined room: ${upperRoomId}, Clients: ${rooms[upperRoomId].size}`);
          } else {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ 
                type: "error", 
                message: "Room not found" 
              }));
            }
            console.log(`Room not found: ${upperRoomId}`);
          }
          break;

        case "chat-message":
          const { roomId, content, sender } = message;
          if (typeof roomId !== "string" || typeof content !== "string" || typeof sender !== "string") {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ 
                type: "error", 
                message: "Invalid chat message format" 
              }));
            }
            break;
          }
          
          const upperChatRoomId = roomId.toUpperCase();
          if (rooms[upperChatRoomId]) {
            rooms[upperChatRoomId].forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(
                  JSON.stringify({
                    type: "chat-message",
                    content,
                    sender,
                    isOwnMessage: client === socket,
                  })
                );
              }
            });
            console.log(`Message in room ${upperChatRoomId} from ${sender}: ${content}`);
          } else {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ 
                type: "error", 
                message: "Room not found" 
              }));
            }
          }
          break;

        default:
          console.log("Unknown message type:", message.type);
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ 
              type: "error", 
              message: "Unknown message type" 
            }));
          }
      }
    } catch (error) {
      console.error("Error processing message:", error);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ 
          type: "error", 
          message: "Invalid message" 
        }));
      }
    }
  });

  socket.on("close", (code: number, reason: Buffer) => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].delete(socket);
      console.log(`Client disconnected from room: ${roomId}, Remaining clients: ${rooms[roomId].size}, Code: ${code}, Reason: ${reason.toString()}`);
      
      // Notify remaining clients about user count update
      if (rooms[roomId].size > 0) {
        rooms[roomId].forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: "user-count-update",
              userCount: rooms[roomId].size
            }));
          }
        });
      } else {
        // Don't delete the room immediately, keep metadata for potential reconnections
        // Room will expire after some time of inactivity
        console.log(`Room ${roomId} is now empty but keeping metadata for potential rejoins`);
      }
    }
  });

  socket.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

console.log("WebSocket server running on ws://localhost:8080");
console.log("Room codes are now 6-character alphanumeric strings");

// Clean up expired rooms every 10 minutes
setInterval(() => {
  const now = new Date();
  const expireTime = 10 * 60 * 1000; // 10 minutes

  Object.keys(roomMetadata).forEach(roomId => {
    const metadata = roomMetadata[roomId];
    const timeSinceActivity = now.getTime() - metadata.lastActivity.getTime();
    
    // If room is empty and hasn't had activity for expireTime, clean it up
    if ((!rooms[roomId] || rooms[roomId].size === 0) && timeSinceActivity > expireTime) {
      delete roomMetadata[roomId];
      if (rooms[roomId]) {
        delete rooms[roomId];
      }
      console.log(`Cleaned up expired room: ${roomId}`);
    }
  });
}, 5 * 60 * 1000); // Check every 5 minutes