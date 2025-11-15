import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// ==================== SUPABASE CONFIG - USE YOUR VALUES ====================
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

// ==================== SUPABASE FUNCTION REPLACEMENTS ====================

// Presence management
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

// If you want to implement reporting/blacklisting, add corresponding Supabase tables and functions.

// ==================== COMPONENTS ====================

// The rest of your file (WaitingScreen, VideoCall, ReportModal, Toast, and App)
// -- no changes except swapping out the MockSupabase method calls for these new async functions above.

function WaitingScreen({ sessionId, onMatchFound }: { sessionId: string; onMatchFound: (matchId: string, peerId: string) => void }) {
  const [searching, setSearching] = useState(true);
  const heartbeatRef = useRef<number | null>(null);
  const matchCheckRef = useRef<number | null>(null);

  useEffect(() => {
    // Initialize presence
    upsertPresence(sessionId, 'waiting');

    // Heartbeat every 5 seconds
    heartbeatRef.current = window.setInterval(() => {
      upsertPresence(sessionId, 'waiting');
    }, 5000);

    // Check for matches every 2 seconds
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

// ... VideoCall, ReportModal, Toast and App remain unchanged, except: use endMatch instead of the old method for ending calls; use your video/WebRTC code as before

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
