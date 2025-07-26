import { useState, useRef, useEffect, useCallback } from 'react';
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;


// Define message type for TypeScript
interface Message {
  type: string;
  roomId?: string;
  content?: string;
  sender?: string;
  isOwnMessage?: boolean;
  message?: string;
  userCount?: number;
}

// Generate short room code (6 characters)
const generateShortCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// UsernameDisplay component
const UsernameDisplay = ({ senderName, setSenderName }: { senderName: string; setSenderName: (name: string) => void }) => {
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [tempName, setTempName] = useState<string>('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const startEditingName = useCallback(() => {
    setTempName(senderName);
    setIsEditingName(true);
  }, [senderName]);

  const saveName = useCallback(() => {
    if (tempName.trim()) {
      setSenderName(tempName.trim());
      setIsEditingName(false);
      setTempName('');
    }
  }, [tempName, setSenderName]);

  const cancelEditingName = useCallback(() => {
    setIsEditingName(false);
    setTempName('');
  }, []);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (tempName.trim()) {
        saveName();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingName();
    }
  }, [tempName, saveName, cancelEditingName]);

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      <span className="text-gray-400 text-sm">Your name:</span>
      {isEditingName ? (
        <div className="flex items-center gap-2">
          <input
            ref={nameInputRef}
            type="text"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-white"
            maxLength={20}
          />
          <button
            onClick={saveName}
            className="text-green-400 hover:text-green-300 text-sm"
          >
            ✓
          </button>
          <button
            onClick={cancelEditingName}
            className="text-red-400 hover:text-red-300 text-sm"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={startEditingName}
          className="text-white hover:text-blue-400 transition-colors text-sm font-medium underline decoration-dotted"
        >
          {senderName}
        </button>
      )}
    </div>
  );
};

// Main App component
const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<'welcome' | 'room-created' | 'chat'>('welcome');
  const [roomCode, setRoomCode] = useState<string>('');
  const [joinRoomCode, setJoinRoomCode] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [senderName, setSenderName] = useState<string>('User' + Math.floor(Math.random() * 1000));
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userCount, setUserCount] = useState<number>(1);
  const messageEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const createRoom = useCallback(() => {
    const shortCode = generateShortCode();
    setRoomCode(shortCode);
    setCurrentScreen('room-created');
    setError(null);

    try {
      const socket = new WebSocket(BACKEND_URL);

      socket.onopen = () => {
        console.log('Connected to WebSocket server for room creation');
        socket.send(JSON.stringify({ type: 'create-room', roomId: shortCode }));
        socket.close();
      };

      socket.onerror = (error) => {
        console.error('Failed to pre-create room on server:', error);
        setError('Server connection failed. Room may not be available for others to join.');
      };
    } catch (err) {
      console.error('Failed to pre-create room:', err);
      setError('Failed to create room on server');
    }
  }, []);

  const connectToWebSocket = useCallback(() => {
    try {
      const socket = new WebSocket(BACKEND_URL);
      setWs(socket);
      setError(null);

      socket.onopen = () => {
        console.log('Connected to WebSocket server');
        setError(null);
        socket.send(JSON.stringify({ type: 'create-room', roomId: roomCode }));
        setCurrentScreen('chat');
      };

      socket.onmessage = (event) => {
        try {
          const data: Message = JSON.parse(event.data);
          console.log('Received message:', data);
          switch (data.type) {
            case 'room-created':
              if (data.roomId) {
                setRoomCode(data.roomId);
              }
              setUserCount(1);
              break;
            case 'joined-room':
              setUserCount(prev => Math.max(prev, 2));
              break;
            case 'chat-message':
              setMessages((prev) => [...prev, data]);
              break;
            case 'user-count-update':
              if (data.userCount) {
                setUserCount(data.userCount);
              }
              break;
            case 'error':
              console.error('Server error:', data.message);
              setError(data.message || 'Server error');
              break;
          }
        } catch (err) {
          console.error('Message parsing error:', err);
          setError('Failed to parse server message');
        }
      };

      socket.onclose = () => {
        console.log('Disconnected from WebSocket server');
        setWs(null);
        if (currentScreen === 'chat') {
          setError('Connection lost');
        }
      };

      socket.onerror = () => {
        console.error('WebSocket error');
        setError('Failed to connect to server. Make sure the WebSocket server is running on localhost:8080');
      };
    } catch (err) {
      console.error('WebSocket setup error:', err);
      setError('Failed to initialize connection');
    }
  }, [roomCode, currentScreen]);

  const joinRoom = useCallback(() => {
    if (!joinRoomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    const upperRoomCode = joinRoomCode.toUpperCase();
    setRoomCode(upperRoomCode);
    setError(null);

    try {
      const socket = new WebSocket(BACKEND_URL);
      setWs(socket);

      socket.onopen = () => {
        console.log('Connected to WebSocket server for joining room');
        setError(null);
        socket.send(JSON.stringify({ type: 'join-room', roomId: upperRoomCode }));
      };

      socket.onmessage = (event) => {
        try {
          const data: Message = JSON.parse(event.data);
          console.log('Received message:', data);
          switch (data.type) {
            case 'joined-room':
              setCurrentScreen('chat');
              setUserCount(2);
              break;
            case 'chat-message':
              setMessages((prev) => [...prev, data]);
              break;
            case 'user-count-update':
              if (data.userCount) {
                setUserCount(data.userCount);
              }
              break;
            case 'error':
              console.error('Server error:', data.message);
              setError(data.message || 'Room not found');
              setCurrentScreen('welcome');
              setRoomCode('');
              break;
          }
        } catch (err) {
          console.error('Message parsing error:', err);
          setError('Failed to parse server message');
        }
      };

      socket.onclose = () => {
        console.log('Disconnected from WebSocket server');
        setWs(null);
        if (currentScreen === 'chat') {
          setError('Connection lost');
        }
      };

      socket.onerror = () => {
        setError('Failed to connect to server. Make sure the WebSocket server is running on localhost:8080');
      };
    } catch (err) {
      setError('Failed to connect');
    }
  }, [joinRoomCode, currentScreen]);

  const sendMessage = useCallback(() => {
    if (ws && ws.readyState === WebSocket.OPEN && inputMessage.trim() && roomCode) {
      ws.send(
        JSON.stringify({
          type: 'chat-message',
          roomId: roomCode,
          content: inputMessage,
          sender: senderName,
        })
      );
      setInputMessage('');
    }
  }, [ws, inputMessage, roomCode, senderName]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (currentScreen === 'chat') {
        sendMessage();
      } else if (currentScreen === 'welcome' && joinRoomCode) {
        joinRoom();
      }
    }
  }, [currentScreen, joinRoomCode, sendMessage, joinRoom]);

  const goBack = useCallback(() => {
    if (ws) {
      ws.close();
      setWs(null);
    }
    setCurrentScreen('welcome');
    setMessages([]);
    setRoomCode('');
    setJoinRoomCode('');
    setError(null);
    setUserCount(1);
  }, [ws]);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
              <div className="w-3 h-3 bg-black rounded-full"></div>
            </div>
            <h1 className="text-2xl font-bold">Real Time Chat</h1>
          </div>
          <p className="text-gray-400 text-sm">temporary room that expires after both users exit</p>
        </div>

        {/* Username Display */}
        <UsernameDisplay senderName={senderName} setSenderName={setSenderName} />

        {/* Welcome Screen */}
        {currentScreen === 'welcome' && (
          <div className="space-y-6">
            <button
              onClick={createRoom}
              className="w-full bg-white text-black py-3 px-6 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Create New Room
            </button>
            
            <div className="flex gap-4 items-center">
              <input
                type="text"
                value={joinRoomCode}
                onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                onKeyPress={handleKeyPress}
                placeholder="Enter Room Code"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-white"
                maxLength={6}
              />
              <button
                onClick={joinRoom}
                className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
              >
                Join Room
              </button>
            </div>
            
            {error && (
              <div className="text-red-400 text-center text-sm">{error}</div>
            )}
          </div>
        )}

        {/* Room Created Screen */}
        {currentScreen === 'room-created' && (
          <div className="space-y-6">
            <button
              onClick={createRoom}
              className="w-full bg-white text-black py-3 px-6 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Create New Room
            </button>
            
            <div className="flex gap-4 items-center">
              <input
                type="text"
                placeholder="Enter Room Code"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-white"
              />
              <button className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors">
                Join Room
              </button>
            </div>

            <div className="bg-gray-800 rounded-lg p-6 text-center">
              <p className="text-gray-400 mb-4">Share this code with your friend</p>
              <div className="text-4xl font-bold tracking-wider mb-6">{roomCode}</div>
              <button
                onClick={connectToWebSocket}
                className="bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Connect to Room
              </button>
              
              {error && (
                <div className="text-red-400 text-center text-sm mt-4">{error}</div>
              )}
            </div>
          </div>
        )}

        {/* Chat Screen */}
        {currentScreen === 'chat' && (
          <div className="space-y-4">
            {/* Header with room info */}
            <div className="bg-gray-800 rounded-lg p-4 flex justify-between items-center">
              <div>
                <div className="font-bold">Room Code: {roomCode}</div>
              </div>
              <div className="text-gray-400">Users: {userCount}</div>
            </div>

            {/* Messages */}
            <div className="bg-gray-900 rounded-lg h-96 p-4 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="text-gray-500 text-center mt-20">
                  No messages yet. Start the conversation!
                </div>
              ) : (
                messages.map((msg, index) => (
                  <div
                    key={index}
                    className={`mb-3 flex ${msg.isOwnMessage ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xs px-4 py-2 rounded-2xl ${
                        msg.isOwnMessage 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-700 text-white'
                      }`}
                    >
                      <div className="text-xs opacity-75 mb-1">{msg.sender}</div>
                      <div>{msg.content}</div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messageEndRef} />
            </div>

            {/* Message Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type a message..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-white"
              />
              <button
                onClick={sendMessage}
                className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
              >
                Send
              </button>
            </div>

            {/* Back button */}
            <button
              onClick={goBack}
              className="w-full bg-gray-800 text-white py-2 px-4 rounded-lg hover:bg-gray-700 transition-colors"
            >
              Leave Room
            </button>

            {error && (
              <div className="text-red-400 text-center text-sm">{error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;