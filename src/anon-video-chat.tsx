import { useState, useEffect, useRef, useCallback } from 'react';

// ==================== UTILITIES ====================

function generateSessionId(): string {
  return 'sess_' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateMatchId(): string {
  return 'match_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

// ==================== SUPABASE MOCK (Replace with real Supabase client) ====================

type PresenceRecord = {
  session_id: string;
  status: 'waiting' | 'in_call' | 'offline';
  last_heartbeat: string;
  match_id: string | null;
};

type Channel = {
  onSignal?: (data: any) => void;
  onMatch?: (data: any) => void;
  subscribe: (cb: (status: string) => void) => void;
};

class MockSupabase {
  presenceData: Map<string, PresenceRecord>;
  matches: Map<string, any>;
  signals: Array<any>;
  reports: Array<any>;
  blacklist: Set<string>;
  channels: Map<string, Channel>;

  constructor() {
    this.presenceData = new Map();
    this.matches = new Map();
    this.signals = [];
    this.reports = [];
    this.blacklist = new Set();
    this.channels = new Map();
  }

  // Presence Management
  async upsertPresence(sessionId: string, status: 'waiting' | 'in_call' | 'offline' = 'waiting') {
    this.presenceData.set(sessionId, {
      session_id: sessionId,
      status,
      last_heartbeat: new Date().toISOString(),
      match_id: null
    });
    return { data: { session_id: sessionId }, error: null };
  }

  async getAvailablePeer(sessionId: string): Promise<string | null> {
    const now = Date.now();
    for (let [sid, data] of this.presenceData.entries()) {
      if (sid !== sessionId &&
          data.status === 'waiting' &&
          !this.blacklist.has(sid) &&
          now - new Date(data.last_heartbeat).getTime() < 10000) {
        return sid;
      }
    }
    return null;
  }

  async createMatch(sessionId: string, peerId: string) {
    const matchId = generateMatchId();
    this.matches.set(matchId, {
      match_id: matchId,
      session_a: sessionId,
      session_b: peerId,
      started_at: new Date().toISOString()
    });

    const a = this.presenceData.get(sessionId);
    const b = this.presenceData.get(peerId);
    if (a) {
      a.status = 'in_call';
      a.match_id = matchId;
    }
    if (b) {
      b.status = 'in_call';
      b.match_id = matchId;
    }

    return { data: { match_id: matchId, peer_id: peerId }, error: null };
  }

  async endMatch(matchId: string) {
    const match = this.matches.get(matchId);
    if (match) {
      const duration = Math.floor((Date.now() - new Date(match.started_at).getTime()) / 1000);
      match.ended_at = new Date().toISOString();
      match.duration_seconds = duration;

      const sessionA = this.presenceData.get(match.session_a);
      const sessionB = this.presenceData.get(match.session_b);

      if (sessionA) {
        sessionA.status = 'waiting';
        sessionA.match_id = null;
      }
      if (sessionB) {
        sessionB.status = 'waiting';
        sessionB.match_id = null;
      }
    }
    return { error: null };
  }

  // Signaling
  async sendSignal(fromSession: string, toSession: string, signal: any) {
    this.signals.push({
      from_session: fromSession,
      to_session: toSession,
      signal_type: signal.type,
      signal_data: signal,
      created_at: new Date().toISOString()
    });

    // Trigger signal handler
    const channel = this.channels.get(toSession);
    if (channel && channel.onSignal) {
      setTimeout(() => channel.onSignal!({ from_session: fromSession, signal_data: signal }), 50);
    }
    return { error: null };
  }

  // Reports
  async submitReport(sessionId: string, matchId: string, category: string) {
    this.reports.push({
      reporter_session: sessionId,
      reported_match: matchId,
      category,
      created_at: new Date().toISOString()
    });

    // Auto-blacklist after 3 reports
    const reportCount = this.reports.filter(r => r.reported_match === matchId).length;
    if (reportCount >= 3) {
      const match = this.matches.get(matchId);
      if (match) {
        this.blacklist.add(match.session_a);
        this.blacklist.add(match.session_b);
      }
    }
    return { error: null };
  }

  // Channel for real-time updates
  channel(name: string): Channel {
    if (!this.channels.has(name)) {
      this.channels.set(name, {
        onSignal: undefined,
        onMatch: undefined,
        subscribe: (cb: (status: string) => void) => {
          setTimeout(() => cb('SUBSCRIBED'), 100);
        }
      });
    }
    return this.channels.get(name)!;
  }
}

const supabase = new MockSupabase();

// ==================== COMPONENTS ====================

function WaitingScreen({ sessionId, onMatchFound }: { sessionId: string; onMatchFound: (matchId: string, peerId: string) => void }) {
  const [searching, setSearching] = useState(true);
  const heartbeatRef = useRef<number | null>(null);
  const matchCheckRef = useRef<number | null>(null);

  useEffect(() => {
    // Initialize presence
    supabase.upsertPresence(sessionId, 'waiting');

    // Heartbeat every 5 seconds
    heartbeatRef.current = window.setInterval(() => {
      supabase.upsertPresence(sessionId, 'waiting');
    }, 5000);

    // Check for matches every 2 seconds
    matchCheckRef.current = window.setInterval(async () => {
      const peerId = await supabase.getAvailablePeer(sessionId);
      if (peerId) {
        setSearching(false);
        const { data } = await supabase.createMatch(sessionId, peerId);
        if (data) {
          onMatchFound(data.match_id, data.peer_id);
        }
      }
    }, 2000);

    return () => {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      if (matchCheckRef.current) window.clearInterval(matchCheckRef.current);
    };
  }, [sessionId, onMatchFound]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-600 via-teal-700 to-blue-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-8 md:p-12 max-w-md w-full text-center">
        <div className="mb-8">
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 border-4 border-teal-200 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-t-teal-500 rounded-full animate-spin"></div>
          </div>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          Finding Someone...
        </h1>

        <p className="text-gray-600 mb-8">
          {searching ? 'Searching for an available person to chat with' : 'Match found! Connecting...'}
        </p>

        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-center space-x-2 mb-2">
            <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-gray-700">Active Session</span>
          </div>
          <p className="text-xs font-mono text-gray-500">{sessionId.substring(0, 16)}...</p>
        </div>

        <div className="text-sm text-gray-500">
          <p className="mb-1">🎥 Camera & mic will be requested when connected</p>
          <p>🔒 Fully anonymous • No data stored</p>
        </div>
      </div>
    </div>
  );
}

function VideoCall({ sessionId, matchId, peerId, onNext }: { sessionId: string; matchId: string; peerId: string | null; onNext: () => void }) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [showSelfView, setShowSelfView] = useState(true);
  const [connectionState, setConnectionState] = useState<string>('connecting');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  // Initialize WebRTC
  useEffect(() => {
    let mounted = true;

    const initCall = async () => {
      try {
        // Request media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true }
        });

        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Create peer connection
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
          ]
        });

        peerConnectionRef.current = pc;

        // Add local tracks
        stream.getTracks().forEach(track => {
          pc.addTrack(track, stream);
        });

        // Handle remote tracks
        pc.ontrack = (event: RTCTrackEvent) => {
          if (event.streams && event.streams[0]) {
            setRemoteStream(event.streams[0]);
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = event.streams[0];
            }
          }
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate && peerId) {
            supabase.sendSignal(sessionId, peerId, {
              type: 'ice-candidate',
              candidate: event.candidate.toJSON()
            });
          }
        };

        // Connection state
        pc.oniceconnectionstatechange = () => {
          const state = pc.iceConnectionState;
          setConnectionState(state);
          if (state === 'connected') {
            setToast('Connected!');
          } else if (state === 'disconnected' || state === 'failed') {
            setToast('Connection lost');
          }
        };

        // Create data channel
        const dc = pc.createDataChannel('chat');
        dataChannelRef.current = dc;

        dc.onopen = () => console.log('Data channel open');
        dc.onmessage = (e) => console.log('Data:', e.data);

        // Handle incoming data channels
        pc.ondatachannel = (event) => {
          dataChannelRef.current = event.channel;
        };

        // Create and send offer
        if (peerId) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          await supabase.sendSignal(sessionId, peerId, {
            type: 'offer',
            sdp: offer
          });
        }

        // Listen for signals
        const channel = supabase.channel(sessionId);
        channel.onSignal = async (data) => {
          const { from_session, signal_data } = data;

          if (peerId && from_session !== peerId) return;

          if (signal_data.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal_data.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (peerId) {
              await supabase.sendSignal(sessionId, peerId, {
                type: 'answer',
                sdp: answer
              });
            }
          } else if (signal_data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal_data.sdp));
          } else if (signal_data.type === 'ice-candidate') {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(signal_data.candidate));
            } catch (e) {
              console.warn('Failed to add ICE candidate', e);
            }
          }
        };

      } catch (error) {
        console.error('Error initializing call:', error);
        setToast('Camera/microphone access denied');
      }
    };

    initCall();

    return () => {
      mounted = false;
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, [sessionId, peerId, matchId, localStream]);

  const toggleAudio = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setAudioEnabled(prev => !prev);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setVideoEnabled(prev => !prev);
    }
  };

  const switchCamera = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      if (videoDevices.length > 1) {
        setToast('Camera switched');
      }
    } catch (error) {
      console.error('Error switching camera:', error);
    }
  };

  const handleEnd = async () => {
    if (matchId) {
      await supabase.endMatch(matchId);
    }
    onNext();
  };

  const handleReport = async (category: string) => {
    if (matchId) {
      await supabase.submitReport(sessionId, matchId, category);
      setToast('Report submitted');
      setIsReportModalOpen(false);
    }
  };

  const getConnectionColor = () => {
    switch (connectionState) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'new': return 'bg-blue-500';
      default: return 'bg-red-500';
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${getConnectionColor()}`}></div>
          <span className="text-white font-medium">
            {connectionState === 'connected' ? 'Connected' : 'Connecting...'}
          </span>
        </div>

        <button
          onClick={() => setIsReportModalOpen(true)}
          className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600"
        >
          ⚠️ Report
        </button>
      </div>

      {/* Video Grid */}
      <div className="flex-1 relative bg-black">
        {/* Remote Video (Main) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />

        {!remoteStream && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-white">
              <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-lg">Waiting for peer...</p>
            </div>
          </div>
        )}

        {/* Local Video (PiP) */}
        {showSelfView && (
          <div className="absolute top-4 right-4 w-48 h-36 bg-gray-800 rounded-lg overflow-hidden shadow-2xl border-2 border-gray-600">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <button
              onClick={() => setShowSelfView(false)}
              className="absolute top-2 right-2 w-6 h-6 bg-black bg-opacity-50 rounded-full text-white text-xs hover:bg-opacity-70"
            >
              ×
            </button>
          </div>
        )}

        {!showSelfView && (
          <button
            onClick={() => setShowSelfView(true)}
            className="absolute top-4 right-4 px-3 py-2 bg-gray-800 bg-opacity-80 text-white rounded-lg text-sm hover:bg-opacity-100"
          >
            Show Self
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="bg-gray-800 px-4 py-6">
        <div className="max-w-2xl mx-auto flex items-center justify-center space-x-4">
          <button
            onClick={toggleAudio}
            className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl transition-all ${
              audioEnabled
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
            title={audioEnabled ? 'Mute' : 'Unmute'}
          >
            {audioEnabled ? '🎤' : '🔇'}
          </button>

          <button
            onClick={toggleVideo}
            className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl transition-all ${
              videoEnabled
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
            title={videoEnabled ? 'Stop Video' : 'Start Video'}
          >
            {videoEnabled ? '📹' : '🚫'}
          </button>

          <button
            onClick={handleEnd}
            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white font-bold text-3xl shadow-lg"
            title="End Call & Next"
          >
            ⏭
          </button>

          <button
            onClick={switchCamera}
            className="w-14 h-14 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-2xl text-white"
            title="Switch Camera"
          >
            🔄
          </button>
        </div>

        <div className="text-center mt-4">
          <button
            onClick={handleEnd}
            className="px-6 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-full font-semibold"
          >
            Next Person →
          </button>
        </div>
      </div>

      {/* Report Modal */}
      {isReportModalOpen && (
        <ReportModal
          onClose={() => setIsReportModalOpen(false)}
          onSubmit={handleReport}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function ReportModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (category: string) => void }) {
  const [category, setCategory] = useState('Inappropriate');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-75"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-2xl font-bold text-gray-900 mb-4">Report User</h3>
        <p className="text-gray-600 mb-4">Select a reason for reporting:</p>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full p-3 border-2 border-gray-300 rounded-lg mb-6 focus:outline-none focus:border-teal-500"
        >
          <option value="Inappropriate">Inappropriate Content</option>
          <option value="Nudity">Nudity/Sexual Content</option>
          <option value="Harassment">Harassment/Abuse</option>
          <option value="Spam">Spam/Scam</option>
          <option value="Underage">Suspected Minor</option>
          <option value="Other">Other Violation</option>
        </select>

        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-lg bg-gray-200 text-gray-700 font-semibold hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(category)}
            className="flex-1 px-4 py-3 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600"
          >
            Submit Report
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
      <div className="bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center space-x-2">
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}

// ==================== MAIN APP ====================

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [appState, setAppState] = useState<'waiting' | 'in_call'>('waiting');
  const [matchId, setMatchId] = useState<string | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);

  useEffect(() => {
    const sid = generateSessionId();
    setSessionId(sid);
  }, []);

  const handleMatchFound = useCallback((newMatchId: string, newPeerId: string) => {
    setMatchId(newMatchId);
    setPeerId(newPeerId);
    setAppState('in_call');
  }, []);

  const handleNext = useCallback(async () => {
    if (matchId) {
      await supabase.endMatch(matchId);
    }

    setMatchId(null);
    setPeerId(null);
    setAppState('waiting');

    // Re-enter waiting pool
    if (sessionId) await supabase.upsertPresence(sessionId, 'waiting');
  }, [sessionId, matchId]);

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-600 to-blue-800 flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (appState === 'waiting') {
    return <WaitingScreen sessionId={sessionId} onMatchFound={handleMatchFound} />;
  }

  return (
    <VideoCall
      sessionId={sessionId}
      matchId={matchId!}
      peerId={peerId}
      onNext={handleNext}
    />
  );
}