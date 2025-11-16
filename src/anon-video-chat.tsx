import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// ==================== SUPABASE CONFIG ====================
const SUPABASE_URL = 'https://xuakgolssjfoohntjidf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YWtnb2xzc2pmb29obnRqaWRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMyMTIyNjEsImV4cCI6MjA3ODc4ODI2MX0.QvxEO0ww_ATqIWt9FAswgp06epMeNyCV_0Qoa508Lto';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// ==================== UTILITIES ====================
function generateSessionId(): string {
  return 'sess_' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
function generateMatchId(): string {
  return 'match_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

// ==================== SUPABASE INTEGRATION ====================
async function upsertPresence(sessionId: string, status: 'waiting' | 'in_call' | 'offline' = 'waiting') {
  await supabase
    .from('sessions')
    .upsert([{ id: sessionId, status, last_heartbeat: new Date().toISOString() }]);
  return { data: { session_id: sessionId }, error: null };
}

async function getAvailablePeer(sessionId: string): Promise<string | null> {
  const { data } = await supabase
    .from('sessions')
    .select('id')
    .eq('status', 'waiting')
    .neq('id', sessionId)
    .order('last_heartbeat', { ascending: false })
    .limit(1);
  return data && data.length ? data[0].id : null;
}

async function createMatch(sessionId: string, peerId: string) {
  const matchId = generateMatchId();
  await supabase
    .from('matches')
    .insert([{ id: matchId, session_a: sessionId, session_b: peerId, started_at: new Date().toISOString() }]);
  await supabase
    .from('sessions')
    .update({ status: 'in_call', match_id: matchId })
    .eq('id', sessionId);
  await supabase
    .from('sessions')
    .update({ status: 'in_call', match_id: matchId })
    .eq('id', peerId);
  return { data: { match_id: matchId, peer_id: peerId }, error: null };
}

async function endMatch(matchId: string) {
  const { data } = await supabase
    .from('matches')
    .select('started_at,session_a,session_b')
    .eq('id', matchId)
    .single();
  if (!data) return { error: null };
  const duration = Math.floor((Date.now() - new Date(data.started_at).getTime()) / 1000);
  await supabase
    .from('matches')
    .update({ ended_at: new Date().toISOString(), duration_seconds: duration })
    .eq('id', matchId);
  await supabase
    .from('sessions')
    .update({ status: 'waiting', match_id: null })
    .in('id', [data.session_a, data.session_b]);
  return { error: null };
}

// --- Improved Supabase signaling (fetch all new signals) ---
let lastSignalTime: { [key: string]: string } = {};

async function sendSignalSupabase(matchId: string, senderId: string, payload: any) {
  await supabase
    .from('signals')
    .insert([{ match_id: matchId, sender_id: senderId, payload: JSON.stringify(payload), created_at: new Date().toISOString() }]);
}

async function receiveAllSignalsSupabase(matchId: string, selfId: string): Promise<any[]> {
  const lastTime = lastSignalTime[matchId] || '1900-01-01T00:00:00Z';
  const { data } = await supabase
    .from('signals')
    .select('id,payload,created_at')
    .eq('match_id', matchId)
    .neq('sender_id', selfId)
    .gt('created_at', lastTime)
    .order('created_at', { ascending: true });

  if (data && data.length) {
    lastSignalTime[matchId] = data[data.length - 1].created_at;
    return data.map(row => JSON.parse(row.payload));
  }
  return [];
}

// ==================== COMPONENTS ====================

function WaitingScreen({ sessionId, onMatchFound }: { sessionId: string; onMatchFound: (matchId: string, peerId: string) => void }) {
  const [searching, setSearching] = useState(true);
  const heartbeatRef = useRef<number | null>(null);
  const matchCheckRef = useRef<number | null>(null);

  useEffect(() => {
    upsertPresence(sessionId, 'waiting');
    heartbeatRef.current = window.setInterval(() => {
      upsertPresence(sessionId, 'waiting');
    }, 5000);
    matchCheckRef.current = window.setInterval(async () => {
      const peerId = await getAvailablePeer(sessionId);
      if (peerId) {
        setSearching(false);
        const { data } = await createMatch(sessionId, peerId);
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
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Finding Someone...</h1>
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

// ==================== VIDEO CALL COMPONENT (WHATSAPP STYLE) ====================
function VideoCall({ sessionId, matchId, peerId, onNext }: { sessionId: string; matchId: string; peerId: string | null; onNext: () => void }) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState('connecting');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const remoteDescriptionSetRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!mounted) return;
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pcRef.current = pc;
        stream.getTracks().forEach(t => pc.addTrack(t, stream));

        pc.ontrack = (event: RTCTrackEvent) => {
          if (event.streams && event.streams[0]) {
            setRemoteStream(event.streams[0]);
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
          }
        };

        pc.onicecandidate = event => {
          if (event.candidate && peerId) {
            sendSignalSupabase(matchId, sessionId, { type: 'ice-candidate', candidate: event.candidate.toJSON() });
          }
        };

        pc.oniceconnectionstatechange = () => {
          const state = pc.iceConnectionState;
          setStatus(state === 'connected' ? 'connected' : state);
        };

        // Only the peer with lower sessionId sends offer
        if (peerId && sessionId < peerId) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await sendSignalSupabase(matchId, sessionId, { type: 'offer', sdp: offer.toJSON() });
        }

        // Poll for all new signals
        const poll = setInterval(async () => {
          const msgs = await receiveAllSignalsSupabase(matchId, sessionId);
          for (const msg of msgs) {
            try {
              if (msg.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                remoteDescriptionSetRef.current = true;

                // Add any pending candidates
                for (const candidate of pendingCandidatesRef.current) {
                  try {
                    await pc.addIceCandidate(candidate);
                  } catch (e) {
                    console.warn('Failed to add pending ICE candidate', e);
                  }
                }
                pendingCandidatesRef.current = [];

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await sendSignalSupabase(matchId, sessionId, { type: 'answer', sdp: answer.toJSON() });
              } else if (msg.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                remoteDescriptionSetRef.current = true;

                // Add any pending candidates
                for (const candidate of pendingCandidatesRef.current) {
                  try {
                    await pc.addIceCandidate(candidate);
                  } catch (e) {
                    console.warn('Failed to add pending ICE candidate', e);
                  }
                }
                pendingCandidatesRef.current = [];

                setStatus('connected');
              } else if (msg.type === 'ice-candidate') {
                if (remoteDescriptionSetRef.current) {
                  try {
                    await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                  } catch (e) {
                    console.warn('Failed to add ICE candidate', e);
                  }
                } else {
                  // Buffer candidate until remote description is set
                  pendingCandidatesRef.current.push(new RTCIceCandidate(msg.candidate));
                }
              }
            } catch (error) {
              console.error('Error handling signal:', error);
            }
          }
        }, 500);

        return () => clearInterval(poll);
      } catch (error) {
        console.error('Error initializing call:', error);
        setStatus('error');
      }
    };

    start();

    return () => {
      mounted = false;
      if (pcRef.current) pcRef.current.close();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
    };
  }, [sessionId, peerId, matchId]);

  const toggleAudio = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setAudioEnabled(!audioEnabled);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setVideoEnabled(!videoEnabled);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col relative">
      {/* Remote Video - Full Screen Background */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Gradient overlay for better contrast */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent pointer-events-none"></div>

      {/* Local Video - PiP Corner (WhatsApp Style) */}
      <div className="absolute bottom-24 right-4 z-40">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-32 h-40 md:w-40 md:h-52 bg-gray-800 rounded-lg border-2 border-white shadow-lg object-cover"
        />
      </div>

      {/* Status Text */}
      <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-30">
        <div className={`px-4 py-2 rounded-full font-semibold text-white ${
          status === 'connected' ? 'bg-green-500' : 'bg-yellow-500'
        }`}>
          {status === 'connected' ? '✓ Connected' : 'Connecting...'}
        </div>
      </div>

      {/* Controls - Bottom Bar */}
      <div className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/80 to-transparent p-6">
        <div className="flex items-center justify-center gap-4 max-w-2xl mx-auto">
          {/* Mute Button */}
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

          {/* Video Button */}
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

          {/* End Call Button */}
          <button
            onClick={async () => {
              if (matchId) await endMatch(matchId);
              onNext();
            }}
            className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white font-bold text-2xl shadow-lg"
            title="End Call"
          >
            📞
          </button>

          {/* Next Button */}
          <button
            onClick={async () => {
              if (matchId) await endMatch(matchId);
              onNext();
            }}
            className="w-14 h-14 rounded-full bg-teal-500 hover:bg-teal-600 flex items-center justify-center text-white font-bold text-lg"
            title="End & Next"
          >
            ⏭️
          </button>
        </div>
      </div>

      {/* Loading Spinner if Connecting */}
      {status !== 'connected' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-white text-lg">Establishing Connection...</p>
          </div>
        </div>
      )}
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
      await endMatch(matchId);
    }
    setMatchId(null);
    setPeerId(null);
    setAppState('waiting');
    if (sessionId) await upsertPresence(sessionId, 'waiting');
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
