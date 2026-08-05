// =========================================
// Coop+ — Smart Chicken Coop Guardian App
// v2.0 — Full UX/HCI Polish
// =========================================

import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Alert,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

/* ─── ERROR BOUNDARY ──────────────────────────────── */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('Coop+ Error Boundary:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Ionicons name="alert-circle" size={48} color="#FF4444" />
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFFFFF', marginTop: 16 }}>Something went wrong</Text>
          <Text style={{ fontSize: 14, color: '#ADADAD', marginTop: 8, textAlign: 'center' }}>Please restart the app to recover.</Text>
          <TouchableOpacity
            onPress={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, backgroundColor: BRAND }}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#1A1A1A' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

import { getTheme, BRAND, BRAND_DARK } from './src/utils/theme';
import PulseRing from './src/components/PulseRing';
const MAX_EVENTS   = 50;
const MAX_VISIBLE  = 6;

/* ─── THEME ───────────────────────────────────────────────── */
/* ─── THREAT HELPERS ──────────────────────────────────────── */
function threatMeta(level, theme) {
  const map = [
    { label: 'All Clear',    sub: 'No motion detected',     color: theme.ok,     icon: 'shield-checkmark' },
    { label: 'Caution',      sub: 'Radar movement nearby',  color: theme.warn,   icon: 'radio' },
    { label: 'Danger',       sub: 'Motion confirmed',       color: theme.warn,   icon: 'eye' },
    { label: 'Alert!',       sub: 'Deterrent active',       color: theme.danger, icon: 'flash' },
  ];
  return map[Math.min(level, 3)];
}

/* ─── UTILITIES ───────────────────────────────────────────── */
const wsUrl   = (h, p) => `ws://${h}:${p}/ws`;
const apiUrl  = (h, p, path) => `http://${h}:${p}${path}`;

async function safeJson(res) {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return {}; }
}

function fmtTime(ms) {
  if (!ms) return '—';
  const n = Number(ms);
  if (!isFinite(n)) return '—';
  return new Date(n).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtRelative(ms) {
  if (!ms) return '';
  const diff = Date.now() - Number(ms);
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return fmtTime(ms);
}

/* ─── MOVIE-STYLE TACTICAL RADAR ──────────────────────────── */
function TacticalRadar({ theme, active, radarActive, pirActive }) {
  const sweepAnim = useRef(new Animated.Value(0)).current;
  const blipOpacity = useRef(new Animated.Value(0)).current;

  // Sweep loop animation
  useEffect(() => {
    const sweep = Animated.loop(
      Animated.timing(sweepAnim, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    sweep.start();
    return () => sweep.stop();
  }, []);

  // Fade target blip in and out when active
  useEffect(() => {
    if (radarActive || pirActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(blipOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(blipOpacity, { toValue: 0.2, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      blipOpacity.setValue(0);
    }
  }, [radarActive, pirActive]);

  const rotate = sweepAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const radarColor = theme.dark ? BRAND : '#7A8200';
  const blipColor = pirActive ? theme.danger : theme.warn;

  return (
    <View style={[styles.radarContainer, { backgroundColor: theme.dark ? '#050D02' : '#F4F9F2', borderColor: radarColor + '20' }]}>
      {/* Concentric grid lines */}
      <View style={[styles.radarRing, { width: 40, height: 40, borderRadius: 20, borderColor: radarColor + '10' }]} />
      <View style={[styles.radarRing, { width: 90, height: 90, borderRadius: 45, borderColor: radarColor + '15' }]} />
      <View style={[styles.radarRing, { width: 140, height: 140, borderRadius: 70, borderColor: radarColor + '20' }]} />
      <View style={[styles.radarCrosshairH, { backgroundColor: radarColor + '10' }]} />
      <View style={[styles.radarCrosshairV, { backgroundColor: radarColor + '10' }]} />

      {/* Sweeper beam */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 140,
            height: 140,
            justifyContent: 'center',
            alignItems: 'center',
            transform: [{ rotate }],
          },
        ]}
      >
        <View
          style={{
            position: 'absolute',
            width: 70,
            height: 2,
            backgroundColor: radarColor,
            opacity: 0.35,
            left: 70, // Sweep line starts at center and extends to the right
          }}
        />
      </Animated.View>

      {/* Target Blip 1 (Microwave Radar Target) */}
      {radarActive && (
        <Animated.View
          style={[
            styles.radarBlip,
            {
              backgroundColor: blipColor,
              top: '25%',
              left: '65%',
              opacity: blipOpacity,
            },
          ]}
        >
          <View style={[styles.radarBlipPulse, { backgroundColor: blipColor }]} />
        </Animated.View>
      )}

      {/* Target Blip 2 (PIR Heat Source Target) */}
      {pirActive && (
        <Animated.View
          style={[
            styles.radarBlip,
            {
              backgroundColor: theme.danger,
              top: '60%',
              left: '35%',
              opacity: blipOpacity,
            },
          ]}
        >
          <View style={[styles.radarBlipPulse, { backgroundColor: theme.danger }]} />
        </Animated.View>
      )}
      
{/* Scan Text Overlay */}
        <View style={styles.radarTextOverlay}>
          {!active ? (
            <Text style={{ fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: 'bold', color: radarColor, opacity: 0.65 }}>
              ⚡ OFFLINE
            </Text>
          ) : (radarActive || pirActive ? (
            <Text style={{ fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: 'bold', color: radarColor, opacity: 0.65 }}>
              ⚠️ TARGET DETECTED
            </Text>
          ) : (
            <Text style={{ fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: 'bold', color: radarColor, opacity: 0.65 }}>
              📡 SCANNING ACTIVE
            </Text>
          ))}
          {active && (
            <Text style={{ fontSize: 8, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: radarColor, opacity: 0.45, marginTop: 2 }}>
              RCWL-0516 · {radarActive ? 'ACTIVE' : 'STANDBY'} · {pirActive ? 'PIR ALERT' : 'RADAR ONLY'}
            </Text>
          )}
        </View>
    </View>
  );
}

/* ─── ANIMATED VALUE CHIP ─────────────────────────────────── */
function SensorChip({ theme, icon, label, value, active, activeColor }) {
  const animBg = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animBg, {
      toValue: active ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [active]);

  const color = active ? activeColor || theme.accent : theme.textMuted;
  const bgColor = animBg.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.surface2, (activeColor || theme.accent) + '1A'],
  });

  return (
    <Animated.View style={[s.chip, { backgroundColor: bgColor, borderColor: active ? color + '30' : theme.border }]}>
      <Ionicons name={icon} size={20} color={color} style={{ marginRight: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</Text>
        <Text style={{ fontSize: 15, fontWeight: '800', color }}>{value}</Text>
      </View>
    </Animated.View>
  );
}

/* ─── TOAST NOTIFICATION ──────────────────────────────────── */
function Toast({ message, type = 'info', theme }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    Animated.sequence([
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.delay(2200),
      Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [message]);

  if (!message) return null;
  const bg = type === 'error' ? theme.danger : type === 'ok' ? theme.ok : theme.surface3;
  const tc = type === 'error' || type === 'ok' ? '#FFF' : theme.text;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        { backgroundColor: bg, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] },
      ]}
    >
      <Ionicons
        name={type === 'error' ? 'close-circle' : type === 'ok' ? 'checkmark-circle' : 'information-circle'}
        size={16} color={tc}
      />
      <Text style={{ fontSize: 13, fontWeight: '600', color: tc, flex: 1 }}>{message}</Text>
    </Animated.View>
  );
}

/* ─── SPLASH ──────────────────────────────────────────────── */
function SplashScreen({ onDone }) {
  const scale = useRef(new Animated.Value(0.75)).current;
  const fade  = useRef(new Animated.Value(1)).current;
  const ring  = useRef(new Animated.Value(1)).current;
  const ringO = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, tension: 55, friction: 8, useNativeDriver: true }).start();
    const pulse = Animated.loop(Animated.sequence([
      Animated.parallel([
        Animated.timing(ring,  { toValue: 1.8, duration: 1000, useNativeDriver: true }),
        Animated.timing(ringO, { toValue: 0,   duration: 1000, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(ring,  { toValue: 1, duration: 0, useNativeDriver: true }),
        Animated.timing(ringO, { toValue: 0.4, duration: 0, useNativeDriver: true }),
      ]),
    ]));
    pulse.start();
    const t = setTimeout(() => {
      pulse.stop();
      Animated.timing(fade, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => onDone());
    }, 2400);
    return () => { clearTimeout(t); pulse.stop(); };
  }, []);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: BRAND, justifyContent: 'center', alignItems: 'center', zIndex: 999, opacity: fade }]}>
      <StatusBar style="dark" />
      <Animated.View style={{ alignItems: 'center', transform: [{ scale }] }}>
        {/* Pulse ring */}
        <Animated.View style={{ position: 'absolute', width: 90, height: 90, borderRadius: 45,
          borderWidth: 2, borderColor: '#1A1A1A', opacity: ringO, transform: [{ scale: ring }] }} />
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}>
          <Ionicons name="shield-checkmark" size={42} color={BRAND} />
        </View>
        <Text style={{ fontSize: 48, fontWeight: '900', color: '#1A1A1A', letterSpacing: -2 }}>Coop+</Text>
        <Text style={{ fontSize: 14, fontWeight: '500', color: 'rgba(26,26,26,0.4)', marginTop: 4, letterSpacing: 1 }}>SMART COOP GUARDIAN</Text>
      </Animated.View>
    </Animated.View>
  );
}

/* ─── ONBOARDING ──────────────────────────────────────────── */
const SLIDES = [
  { key: 'welcome', icon: 'shield-checkmark', title: 'Welcome to Coop+', body: 'Your intelligent predator defence system. Monitor threats and protect your flock 24/7.' },
  { key: 'pair',    icon: 'wifi',              title: 'Pair Your Coop',   body: 'Auto-detects your Smart Coop Defender on the local Wi-Fi. One tap and you\'re connected.' },
  { key: 'protect', icon: 'analytics',         title: 'Stay in Control',  body: 'Live threat alerts, sensor telemetry, event history, and instant deterrent activation.' },
];

function OnboardingScreen({ theme, step, endpoint, setEndpoint, onNext, onBack, onSkip, onStart, onDetect, detecting }) {
  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;
  const isPair = slide.key === 'pair';

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={ob.wrap}>
        <TouchableOpacity onPress={onSkip} style={ob.skip} hitSlop={12}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: theme.textSub }}>Skip</Text>
        </TouchableOpacity>

        {/* Icon */}
        <View style={ob.iconArea}>
          <View style={[ob.iconCircle, { backgroundColor: theme.accentDim }]}>
            <Ionicons name={slide.icon} size={56} color={theme.accent} />
          </View>
        </View>

        {/* Text */}
        <View style={ob.textArea}>
          <Text style={[ob.title, { color: theme.text }]}>{slide.title}</Text>
          <Text style={[ob.body,  { color: theme.textSub }]}>{slide.body}</Text>
        </View>

        {/* Pair step inputs */}
        {isPair && (
          <View style={{ gap: 10 }}>
            <TouchableOpacity
              onPress={onDetect}
              style={[styles.btnPrimary, { backgroundColor: BRAND }]}
              activeOpacity={0.82}
            >
              <Ionicons name={detecting ? 'hourglass' : 'search'} size={18} color="#1A1A1A" />
              <Text style={styles.btnPrimaryTxt}>{detecting ? 'Scanning network…' : 'Auto-Detect Coop'}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 2 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
              <Text style={{ fontSize: 12, color: theme.textMuted, fontWeight: '600' }}>OR ENTER MANUALLY</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
            </View>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]}
              placeholder="IP address  (e.g. 192.168.1.50)"
              placeholderTextColor={theme.textMuted}
              value={endpoint.host}
              onChangeText={h => setEndpoint(p => ({ ...p, host: h }))}
              autoCapitalize="none" autoCorrect={false}
            />
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border, width: 120 }]}
              placeholder="Port  (80)"
              placeholderTextColor={theme.textMuted}
              value={endpoint.port}
              onChangeText={p => setEndpoint(prev => ({ ...prev, port: p }))}
              keyboardType="numeric"
            />
          </View>
        )}

        {/* Dots */}
        <View style={ob.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[ob.dot, { width: i === step ? 24 : 7, backgroundColor: i === step ? theme.accent : theme.surface3 }]} />
          ))}
        </View>

        {/* Buttons */}
        <View style={{ gap: 10 }}>
          <TouchableOpacity
            onPress={isLast ? onStart : onNext}
            style={[styles.btnPrimary, { backgroundColor: BRAND }]}
            activeOpacity={0.82}
          >
            <Text style={styles.btnPrimaryTxt}>{isLast ? 'Get Started →' : 'Continue'}</Text>
          </TouchableOpacity>
          {step > 0 && (
            <TouchableOpacity onPress={onBack} style={[styles.btnSecondary, { backgroundColor: theme.surface2 }]} activeOpacity={0.75}>
              <Text style={[styles.btnSecondaryTxt, { color: theme.textSub }]}>← Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const ob = StyleSheet.create({
  wrap:       { flex: 1, paddingHorizontal: 28, paddingBottom: 40, gap: 28, justifyContent: 'center' },
  skip:       { position: 'absolute', top: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) + 10 : 20, right: 28, padding: 10, zIndex: 10 },
  iconArea:   { alignItems: 'center', marginTop: 40 },
  iconCircle: { width: 110, height: 110, borderRadius: 55, justifyContent: 'center', alignItems: 'center' },
  textArea:   { gap: 10, alignItems: 'center' },
  title:      { fontSize: 30, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5 },
  body:       { fontSize: 15, lineHeight: 23, textAlign: 'center' },
  dots:       { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot:        { height: 7, borderRadius: 3.5 },
});

/* ─── MAIN APP ────────────────────────────────────────────── */
export default function App() {
  const sys = useColorScheme();

  /* State */
  const [endpoint,   setEndpoint]   = useState({ host: '', port: '80' });
  const [status,     setStatus]     = useState({ device: { pir:false,radar:false,light:false,armed:false,online:false,deterrentActive:false,threatLevel:0,threatLabel:'clear',ip:'',updatedAt:null,commands:[],events:[] }, api:{} });
  const [events,     setEvents]     = useState([]);
  const [commands,   setCommands]   = useState([]);
  const [connected,  setConnected]  = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [detecting,  setDetecting]  = useState(false);
  const [toast,      setToast]      = useState({ msg: '', type: 'info' });
  const [screen,     setScreen]     = useState('home');
  const [histTab,    setHistTab]    = useState('events');
  const [showAll,    setShowAll]    = useState(false);
  const [onboarded,  setOnboarded]  = useState(false);
  const [obStep,     setObStep]     = useState(0);
  const [themeMode,  setThemeMode]  = useState('system');
  const [splash,     setSplash]     = useState(true);

  const ws        = useRef(null);
  const recoTimer = useRef(null);
  const canReco   = useRef(true);

  const theme   = useMemo(() => getTheme(themeMode, sys), [themeMode, sys]);
  const dev     = status.device;
  const tm      = useMemo(() => threatMeta(dev?.threatLevel ?? 0, theme), [dev?.threatLevel, theme]);
  const evList  = useMemo(() => (Array.isArray(dev?.events) && dev.events.length ? dev.events : events).slice(0, MAX_EVENTS), [dev?.events, events]);
  const cmdList = useMemo(() => (Array.isArray(dev?.commands) && dev.commands.length ? dev.commands : commands), [dev?.commands, commands]);

  const visEv  = showAll ? evList  : evList.slice(0, MAX_VISIBLE);
  const visCmd = showAll ? cmdList : cmdList.slice(0, MAX_VISIBLE);

  /* Toast helper */
  const showToast = useCallback((msg, type = 'info') => setToast({ msg, type }), []);

  /* Cleanup */
  useEffect(() => () => {
    canReco.current = false;
    clearTimeout(recoTimer.current);
    ws.current?.close();
  }, []);

  /* ─── NETWORKING ─────────────────────────── */
  async function loadStatus(host = endpoint.host, port = endpoint.port) {
    const res  = await fetch(apiUrl(host, port, '/api/status'));
    if (!res.ok) throw new Error(`Device returned ${res.status}`);
    const data = await safeJson(res);
    setStatus(data);
    if (Array.isArray(data?.device?.commands)) setCommands(data.device.commands);
    if (Array.isArray(data?.device?.events))   setEvents(data.device.events.slice(0, MAX_EVENTS));
    return data;
  }

  function attachWs(host, port) {
    const sock = new WebSocket(wsUrl(host, port));
    ws.current = sock;
    sock.onopen = () => {
      setConnected(true);
      setConnecting(false);
      showToast(`Connected to ${host}`, 'ok');
    };
    sock.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        setStatus(d);
        if (Array.isArray(d?.device?.commands)) setCommands(d.device.commands);
        if (Array.isArray(d?.device?.events))   setEvents(d.device.events.slice(0, MAX_EVENTS));
      } catch {}
    };
    sock.onerror  = () => showToast('WebSocket error', 'error');
    sock.onclose  = () => {
      if (canReco.current) {
        setConnecting(true);
        recoTimer.current = setTimeout(connectWithHost.bind(null, host, port), 4000);
      } else {
        setConnected(false);
        setConnecting(false);
      }
    };
  }

  async function connectWithHost(host, port) {
    setConnecting(true);
    canReco.current = false;
    ws.current?.close();
    ws.current = null;
    canReco.current = true;
    try {
      await loadStatus(host, port);
      setConnected(true);
      setConnecting(false);
      attachWs(host, port);
      setOnboarded(true);
      if (screen !== 'home') setScreen('home');
    } catch (e) {
      setConnected(false);
      setConnecting(false);
      showToast(e.message, 'error');
    }
  }

  async function connect() {
    if (connected)   { showToast('Already connected', 'ok'); return; }
    if (connecting)  { return; }  // prevent double-tap stacking
    const host = endpoint.host.trim();
    const port = (endpoint.port || '80').trim();
    if (!host) { await autoDetect(); return; }
    await connectWithHost(host, port);
  }

  async function autoDetect() {
    if (connected)  { showToast('Already connected to Coop+', 'ok'); return; }
    if (detecting)  { return; }  // prevent stacking
    setDetecting(true);
    showToast('Scanning local network…');

    const priority = ['coop-plus.local','smart-coop.local','192.168.1.50','192.168.0.50','192.168.1.100','192.168.0.100','192.168.4.1'];
    for (const host of priority) {
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 800);
        const res  = await fetch(apiUrl(host, '80', '/api/status'), { signal: ctrl.signal });
        clearTimeout(tid);
        if (res.ok) {
          const data = await safeJson(res);
          if (data?.device) {
            setEndpoint({ host, port: '80' });
            setStatus(data);
            setDetecting(false);
            await connectWithHost(host, '80');
            return true;
          }
        }
      } catch {}
    }

    /* Parallel subnet sweep */
    for (const sub of ['192.168.1','192.168.0','192.168.26']) {
      for (let i = 2; i <= 254; i += 25) {
        const batch = [];
        for (let j = i; j < i + 25 && j <= 254; j++) {
          const ip = `${sub}.${j}`;
          batch.push((async () => {
            try {
              const ctrl = new AbortController();
              const tid  = setTimeout(() => ctrl.abort(), 600);
              const res  = await fetch(apiUrl(ip, '80', '/api/status'), { signal: ctrl.signal });
              clearTimeout(tid);
              if (res.ok) {
                const d = await safeJson(res);
                if (d?.device) return { ip, d };
              }
            } catch {}
            return null;
          })());
        }
        const found = (await Promise.all(batch)).find(Boolean);
        if (found) {
          setEndpoint({ host: found.ip, port: '80' });
          setStatus(found.d);
          setDetecting(false);
          await connectWithHost(found.ip, '80');
          return true;
        }
      }
    }

    setDetecting(false);
    showToast('Coop not found on this network', 'error');
    Alert.alert('Not Found', 'Enter the IP address manually or check the coop is on the same Wi-Fi.');
    return false;
  }

  async function sendCmd(path, body) {
    try {
      const res = await fetch(apiUrl(endpoint.host, endpoint.port, path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      if (!res.ok) { const d = await safeJson(res); throw new Error(d.error || `Error ${res.status}`); }
      await loadStatus();
      showToast('Command sent', 'ok');
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function toggleComponent(component) {
    try {
      const res = await fetch(apiUrl(endpoint.host, endpoint.port, '/api/commands/toggle_component'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component }),
      });
      if (!res.ok) { const d = await safeJson(res); throw new Error(d.error || `Error ${res.status}`); }
      await loadStatus();
      showToast(`${component} toggled`, 'ok');
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function clearEvents() {
    try {
      const res = await fetch(apiUrl(endpoint.host, endpoint.port, '/api/events'), { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setEvents([]); showToast('Events cleared', 'ok');
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function clearCommands() {
    try {
      const res = await fetch(apiUrl(endpoint.host, endpoint.port, '/api/commands'), { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setCommands([]); showToast('Commands cleared', 'ok');
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function deleteCmd(id) {
    try {
      await fetch(apiUrl(endpoint.host, endpoint.port, `/api/commands/${id}`), { method: 'DELETE' });
      setCommands(p => p.filter(c => c.id !== id));
    } catch (e) { showToast(e.message, 'error'); }
  }

  function disconnect() {
    canReco.current = false;
    clearTimeout(recoTimer.current);
    ws.current?.close(); ws.current = null;
    setConnected(false); setConnecting(false);
    showToast('Disconnected');
  }

  /* ─── SCREENS ────────────────────────────── */

  function renderHome() {
    const level    = dev?.threatLevel ?? 0;
    const alerting = dev?.deterrentActive;

    return (
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 30, gap: 14, paddingTop: 8 }}>

        {/* ── HERO CARD ── */}
        <View style={[s.heroCard, { backgroundColor: theme.surface }]}>
          {/* Pulse ring behind icon */}
          <View style={{ alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
            <View style={{ position: 'relative', width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }}>
              <PulseRing color={tm.color} size={80} active={alerting || level >= 2} />
              <View style={[s.heroIconCircle, { backgroundColor: tm.color + '20' }]}>
                <Ionicons name={tm.icon} size={34} color={tm.color} />
              </View>
            </View>
          </View>

          <View style={{ alignItems: 'center', gap: 4, marginBottom: 12 }}>
            <Text style={{ fontSize: 32, fontWeight: '900', color: tm.color, letterSpacing: -1 }}>{tm.label}</Text>
            <Text style={{ fontSize: 13, color: theme.textSub, fontWeight: '500' }}>{tm.sub}</Text>
          </View>

          {/* Level bar */}
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textMuted, letterSpacing: 0.8 }}>THREAT LEVEL</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: tm.color, letterSpacing: 0.5 }}>{level} / 3</Text>
            </View>
            <View style={[s.levelTrack, { backgroundColor: theme.surface2 }]}>
              {[0,1,2,3].map(i => (
                <View key={i} style={{ flex: 1, marginHorizontal: 1.5, borderRadius: 3,
                  backgroundColor: i <= level ? tm.color : theme.surface3, height: '100%' }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 }}>
              {['Clear','Caution','Danger','Alert'].map((l, i) => (
                <Text key={i} style={{ fontSize: 9, fontWeight: i <= level ? '700' : '500',
                  color: i <= level ? tm.color : theme.textMuted, letterSpacing: 0.3 }}>{l}</Text>
              ))}
            </View>
         </View>

        </View>

        {/* ── QUICK ACTIONS ── */}
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textMuted, letterSpacing: 1, marginLeft: 2 }}>QUICK ACTIONS</Text>

          <TouchableOpacity
            onPress={() => { if (!connected) return; Alert.alert('Confirm', 'Trigger the deterrent now?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Trigger', style: 'destructive', onPress: () => sendCmd('/api/commands/deterrent', { type: 'deterrent' }) },
            ]); }}
            style={[s.actionBtn, { backgroundColor: BRAND, opacity: connected ? 1 : 0.4 }]}
            activeOpacity={0.84}
            disabled={!connected}
          >
            <Ionicons name="flash" size={20} color="#1A1A1A" />
            <Text style={s.actionBtnTxt}>Trigger Deterrent</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              onPress={() => { if (!connected) return; sendCmd('/api/commands/arm', { mode: 'on' }); }}
              style={[s.actionBtnOutline, { flex: 1, borderColor: theme.ok, opacity: connected ? 1 : 0.4 }]}
              activeOpacity={0.8}
              disabled={!connected}
            >
              <Ionicons name="lock-closed" size={17} color={theme.ok} />
              <Text style={[s.actionBtnOutlineTxt, { color: theme.ok }]}>Arm</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { if (!connected) return; sendCmd('/api/commands/arm', { mode: 'off' }); }}
              style={[s.actionBtnOutline, { flex: 1, borderColor: theme.danger, opacity: connected ? 1 : 0.4 }]}
              activeOpacity={0.8}
              disabled={!connected}
            >
              <Ionicons name="lock-open" size={17} color={theme.danger} />
              <Text style={[s.actionBtnOutlineTxt, { color: theme.danger }]}>Disarm</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { if (!connected) return; sendCmd('/api/commands/arm', { mode: 'auto' }); }}
              style={[s.actionBtnOutline, { flex: 1, borderColor: theme.accent, opacity: connected ? 1 : 0.4 }]}
              activeOpacity={0.8}
              disabled={!connected}
            >
              <Ionicons name="moon" size={17} color={theme.accent} />
              <Text style={[s.actionBtnOutlineTxt, { color: theme.accent }]}>Auto</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── RECENT EVENTS PREVIEW ── */}
        {evList.length > 0 && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textMuted, letterSpacing: 1, marginLeft: 2 }}>RECENT EVENTS</Text>
              <TouchableOpacity onPress={() => { if (!connected) return; setScreen('history'); setHistTab('events'); }} hitSlop={8}
                disabled={!connected} style={{ opacity: connected ? 1 : 0.4 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.accent }}>See All →</Text>
              </TouchableOpacity>
            </View>
            {evList.slice(0, 3).map(ev => <EventRow key={ev.id} theme={theme} ev={ev} compact />)}
          </View>
        )}

        {/* ── CONNECTION PANEL — only visible when offline ── */}
        {!connected && !connecting && (
          <View style={[s.card, { backgroundColor: theme.surface, gap: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.danger }} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textMuted, letterSpacing: 1 }}>NOT CONNECTED</Text>
            </View>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]}
              placeholder="IP address or coop-plus.local"
              placeholderTextColor={theme.textMuted}
              value={endpoint.host}
              onChangeText={h => setEndpoint(p => ({ ...p, host: h }))}
              autoCapitalize="none" autoCorrect={false}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={connect}
                disabled={connecting}
                style={[s.actionBtn, { backgroundColor: BRAND, flex: 1, opacity: connecting ? 0.55 : 1 }]}
                activeOpacity={0.84}
              >
                <Ionicons name="wifi" size={17} color="#1A1A1A" />
                <Text style={[s.actionBtnTxt, { fontSize: 14 }]}>Connect</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={autoDetect}
                disabled={detecting}
                style={[s.iconBtn, { backgroundColor: theme.surface2, borderColor: theme.border, opacity: detecting ? 0.55 : 1 }]}
                activeOpacity={0.8}
              >
                <Ionicons name="search" size={20} color={theme.textSub} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Connecting spinner row */}
        {connecting && !connected && (
          <View style={[s.card, { backgroundColor: theme.surface, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <Ionicons name="hourglass-outline" size={20} color={theme.accent} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.textSub, flex: 1 }}>Connecting to coop…</Text>
            <TouchableOpacity onPress={() => { setConnecting(false); }} hitSlop={10}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: theme.danger }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    );
  }

  function renderStatus() {
    const rows = [
      { icon: 'globe-outline',          label: 'Device IP',    val: dev?.ip || endpoint.host || '—' },
      { icon: 'time-outline',           label: 'Last Update',  val: fmtTime(dev?.updatedAt) },
      { icon: 'eye-outline',            label: 'PIR',          val: dev?.pir ? 'Active' : 'Clear',        vc: dev?.pir ? theme.warn : theme.ok },
      { icon: 'radio-outline',          label: 'Radar',        val: dev?.radar ? 'Active' : 'Clear',      vc: dev?.radar ? theme.warn : theme.ok },
      { icon: 'sunny-outline',          label: 'Light',        val: dev?.light ? 'Dark' : 'Bright' },
      { icon: 'flash-outline',          label: 'Deterrent',    val: dev?.deterrentActive ? 'Active' : 'Idle', vc: dev?.deterrentActive ? theme.danger : theme.ok },
      { icon: 'shield-checkmark-outline',label: 'Armed State', val: dev?.armed ? 'Armed' : 'Disarmed',   vc: dev?.armed ? theme.ok : theme.textSub },
      { icon: 'wifi-outline',           label: 'Connected',    val: connected ? 'Yes' : 'No',             vc: connected ? theme.ok : theme.danger },
    ];

    return (
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 30, paddingTop: 8, gap: 14 }}>
<View style={{ gap: 2 }}>
           <Text style={{ fontSize: 26, fontWeight: '800', color: theme.text, letterSpacing: -0.5 }}>Device Health</Text>
           <Text style={{ fontSize: 14, color: theme.textSub }}>Live sensor telemetry</Text>
         </View>
         <TacticalRadar theme={theme} active={connected} radarActive={!!dev?.radar} pirActive={!!dev?.pir} />
         <View style={{ gap: 8 }}>
           <View style={{ flexDirection: 'row', gap: 8 }}>
             <SensorChip theme={theme} icon="eye-outline" label="PIR" value={dev?.pir ? 'Active' : 'Clear'} active={!!dev?.pir} activeColor={theme.warn} />
             <SensorChip theme={theme} icon="radio-outline" label="Radar" value={dev?.radar ? 'Active' : 'Clear'} active={!!dev?.radar} activeColor={theme.warn} />
           </View>
           <View style={{ flexDirection: 'row', gap: 8 }}>
             <SensorChip theme={theme} icon="sunny-outline" label="Light" value={dev?.light ? 'Dark' : 'Bright'} active={!!dev?.light} />
             <SensorChip theme={theme} icon={dev?.armed ? 'lock-closed' : 'lock-open-outline'} label="System" value={dev?.armed ? 'Armed' : 'Disarmed'} active={!!dev?.armed} activeColor={theme.ok} />
           </View>
         </View>
         <View style={[s.card, { backgroundColor: theme.surface }]}>
          {rows.map((r, i) => (
            <View key={i} style={[s.statusRow, { borderBottomColor: theme.border, borderBottomWidth: i < rows.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={[s.statusIcon, { backgroundColor: theme.accentDim }]}>
                  <Ionicons name={r.icon} size={16} color={theme.accent} />
                </View>
                <Text style={{ fontSize: 14, color: theme.textSub, fontWeight: '500' }}>{r.label}</Text>
              </View>
              <Text style={{ fontSize: 14, fontWeight: '700', color: r.vc || theme.text }}>{r.val}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  function renderHistory() {
    const isEvents = histTab === 'events';
    const hasMore  = isEvents ? evList.length > MAX_VISIBLE : cmdList.length > MAX_VISIBLE;

    return (
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 30, paddingTop: 8, gap: 14 }}>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <Text style={{ fontSize: 26, fontWeight: '800', color: theme.text, letterSpacing: -0.5 }}>Activity</Text>
            <Text style={{ fontSize: 14, color: theme.textSub }}>Event & command log</Text>
          </View>
          <TouchableOpacity
            onPress={isEvents ? clearEvents : clearCommands}
            hitSlop={8}
            style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.dangerDim }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.danger }}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* Segment */}
        <View style={[s.segment, { backgroundColor: theme.surface2 }]}>
          {[
            { key: 'events',   label: 'Event History', icon: 'time',      count: evList.length },
            { key: 'commands', label: 'Commands',       icon: 'list',      count: cmdList.length },
          ].map(tab => {
            const active = histTab === tab.key;
            return (
              <TouchableOpacity key={tab.key} onPress={() => { setHistTab(tab.key); setShowAll(false); }}
                style={[s.segItem, active && { backgroundColor: BRAND }]} activeOpacity={0.8}>
                <Ionicons name={tab.icon} size={14} color={active ? '#1A1A1A' : theme.textSub} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: active ? '#1A1A1A' : theme.textSub }}>
                  {tab.label}
                  <Text style={{ fontWeight: '500' }}> ({tab.count})</Text>
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Event list */}
        {isEvents && (
          evList.length > 0 ? (
            <View style={{ gap: 8 }}>
              {visEv.map(ev => <EventRow key={ev.id} theme={theme} ev={ev} />)}
              {hasMore && (
                <TouchableOpacity onPress={() => setShowAll(p => !p)} style={[s.moreBtn, { backgroundColor: theme.surface2 }]} activeOpacity={0.8}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.textSub }}>
                    {showAll ? 'Show less' : `Show all ${evList.length} events`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : <EmptyState theme={theme} icon="shield-outline"  title="No events yet" body="Motion alerts, radar detections, and deterrent triggers will appear here." />
        )}

        {/* Command list */}
        {!isEvents && (
          cmdList.length > 0 ? (
            <View style={{ gap: 8 }}>
              {visCmd.map(cmd => <CmdRow key={cmd.id} theme={theme} cmd={cmd} onDelete={() => deleteCmd(cmd.id)} />)}
              {hasMore && (
                <TouchableOpacity onPress={() => setShowAll(p => !p)} style={[s.moreBtn, { backgroundColor: theme.surface2 }]} activeOpacity={0.8}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.textSub }}>
                    {showAll ? 'Show less' : `Show all ${cmdList.length} commands`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : <EmptyState theme={theme} icon="list-outline" title="No commands sent" body="Manual deterrent triggers and arm mode changes will appear here." />
        )}
      </ScrollView>
    );
  }

  function renderSettings() {
    return (
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40, paddingTop: 8, gap: 20 }}>
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 26, fontWeight: '800', color: theme.text, letterSpacing: -0.5 }}>Settings</Text>
          <Text style={{ fontSize: 14, color: theme.textSub }}>Device pairing & preferences</Text>
        </View>

{/* ── LIVE STATUS CARD — shown only when connected ── */}
         {connected ? (
           <View style={[s.card, { backgroundColor: theme.okDim, borderWidth: 1, borderColor: theme.ok + '40', gap: 14 }]}>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
               <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.ok }} />
               <Text style={{ fontSize: 13, fontWeight: '700', color: theme.ok, flex: 1 }}>Connected to Coop+</Text>
             </View>
             <View style={{ gap: 4 }}>
               <Text style={{ fontSize: 12, color: theme.textSub }}>
                 <Text style={{ fontWeight: '700' }}>Address: </Text>{endpoint.host}:{endpoint.port}
               </Text>
               {dev?.ip ? (
                 <Text style={{ fontSize: 12, color: theme.textSub }}>
                   <Text style={{ fontWeight: '700' }}>Device IP: </Text>{dev.ip}
                 </Text>
               ) : null}
             </View>
             <TouchableOpacity
               onPress={() => Alert.alert('Disconnect', 'Disconnect from Coop+?', [
                 { text: 'Cancel', style: 'cancel' },
                 { text: 'Disconnect', style: 'destructive', onPress: disconnect },
               ])}
               style={[s.actionBtnOutline, { borderColor: theme.danger, alignSelf: 'flex-start', paddingHorizontal: 18 }]}
               activeOpacity={0.8}
             >
               <Ionicons name="wifi" size={15} color={theme.danger} />
               <Text style={{ fontSize: 14, fontWeight: '600', color: theme.danger }}>Disconnect</Text>
             </TouchableOpacity>
           </View>
         ) : (
           <>
             {/* Network Discovery — only when offline */}
             <SettingGroup theme={theme} title="FIND COOP AUTOMATICALLY">
               <TouchableOpacity
                 onPress={autoDetect}
                 disabled={detecting || connecting}
                 style={[s.actionBtn, { backgroundColor: BRAND, opacity: detecting || connecting ? 0.55 : 1 }]}
                 activeOpacity={0.84}
               >
                 <Ionicons name={detecting ? 'hourglass-outline' : 'search'} size={18} color="#1A1A1A" />
                 <Text style={s.actionBtnTxt}>{detecting ? 'Scanning network…' : 'Auto-Detect Coop on Wi-Fi'}</Text>
               </TouchableOpacity>
               <Text style={{ fontSize: 12, color: theme.textMuted, lineHeight: 17 }}>
                 Scans your local Wi-Fi for any Coop+ device. Both must be on the same network.
               </Text>
             </SettingGroup>

             {/* Manual address — only when offline */}
             <SettingGroup theme={theme} title="CONNECT MANUALLY">
               <View style={{ flexDirection: 'row', gap: 8 }}>
                 <TextInput
                   style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border, flex: 1 }]}
                   placeholder="IP or coop-plus.local"
                   placeholderTextColor={theme.textMuted}
                   value={endpoint.host}
                   onChangeText={h => setEndpoint(p => ({ ...p, host: h }))}
                   autoCapitalize="none" autoCorrect={false}
                 />
                 <TextInput
                   style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border, width: 72 }]}
                   placeholder="80"
                   placeholderTextColor={theme.textMuted}
                   value={endpoint.port}
                   onChangeText={p => setEndpoint(prev => ({ ...prev, port: p }))}
                   keyboardType="numeric"
                 />
               </View>
               <TouchableOpacity
                 onPress={connect}
                 disabled={connecting}
                 style={[s.actionBtn, { backgroundColor: BRAND, opacity: connecting ? 0.55 : 1 }]}
                 activeOpacity={0.84}
               >
                 <Ionicons name="wifi" size={17} color="#1A1A1A" />
                 <Text style={[s.actionBtnTxt, { fontSize: 14 }]}>{connecting ? 'Connecting…' : 'Connect'}</Text>
               </TouchableOpacity>
             </SettingGroup>
           </>
         )}

         {/* Appearance */}
         <SettingGroup theme={theme} title="APPEARANCE">
           <View style={{ flexDirection: 'row', gap: 8 }}>
             {[['system','System','moon-outline'],['dark','Dark','moon'],['light','Light','sunny']].map(([val, lbl, ic]) => (
               <TouchableOpacity key={val} onPress={() => setThemeMode(val)}
                 style={[s.themeChip, { backgroundColor: themeMode === val ? BRAND : theme.surface2,
                   borderColor: themeMode === val ? BRAND : theme.border, flex: 1 }]}
                 activeOpacity={0.8}>
                 <Ionicons name={ic} size={16} color={themeMode === val ? '#1A1A1A' : theme.textSub} />
                 <Text style={{ fontSize: 12, fontWeight: '700', color: themeMode === val ? '#1A1A1A' : theme.textSub }}>{lbl}</Text>
               </TouchableOpacity>
             ))}
           </View>
         </SettingGroup>

         {/* Components — only when connected */}
         {connected ? (
           <SettingGroup theme={theme} title="COMPONENTS">
             <View style={[s.statusRow, { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                 <View style={[s.statusIcon, { backgroundColor: theme.accentDim }]}>
                   <Ionicons name="radio-outline" size={16} color={theme.accent} />
                 </View>
                 <Text style={{ fontSize: 14, color: theme.textSub, fontWeight: '500' }}>Radar</Text>
               </View>
               <Switch value={dev?.components?.radar ?? true} onValueChange={() => toggleComponent('radar')}
                 trackColor={{ false: theme.surface3, true: theme.ok + '40' }} thumbColor={dev?.components?.radar ? theme.ok : theme.textMuted} />
             </View>
             <View style={[s.statusRow, { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                 <View style={[s.statusIcon, { backgroundColor: theme.accentDim }]}>
                   <Ionicons name="eye-outline" size={16} color={theme.accent} />
                 </View>
                 <Text style={{ fontSize: 14, color: theme.textSub, fontWeight: '500' }}>PIR Sensor</Text>
               </View>
               <Switch value={dev?.components?.pir ?? true} onValueChange={() => toggleComponent('pir')}
                 trackColor={{ false: theme.surface3, true: theme.ok + '40' }} thumbColor={dev?.components?.pir ? theme.ok : theme.textMuted} />
             </View>
             <View style={[s.statusRow, { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                 <View style={[s.statusIcon, { backgroundColor: theme.accentDim }]}>
                   <Ionicons name="flash-outline" size={16} color={theme.accent} />
                 </View>
                 <Text style={{ fontSize: 14, color: theme.textSub, fontWeight: '500' }}>Deterrent</Text>
               </View>
               <Switch value={dev?.components?.deterrent ?? true} onValueChange={() => toggleComponent('deterrent')}
                 trackColor={{ false: theme.surface3, true: theme.danger + '40' }} thumbColor={dev?.components?.deterrent ? theme.danger : theme.textMuted} />
             </View>
             <View style={s.statusRow}>
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                 <View style={[s.statusIcon, { backgroundColor: theme.accentDim }]}>
                   <Ionicons name="grid-outline" size={16} color={theme.accent} />
                 </View>
                 <Text style={{ fontSize: 14, color: theme.textSub, fontWeight: '500' }}>LED Matrix</Text>
               </View>
                <Switch value={dev?.components?.matrix ?? true} onValueChange={() => toggleComponent('matrix')}
                  trackColor={{ false: theme.surface3, true: theme.ok + '40' }} thumbColor={dev?.components?.matrix ? theme.ok : theme.textMuted} />
              </View>
              <View style={s.statusRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={[s.statusIcon, { backgroundColor: theme.accentDim }]}>
                    <Ionicons name="volume-high-outline" size={16} color={theme.accent} />
                  </View>
                  <Text style={{ fontSize: 14, color: theme.textSub, fontWeight: '500' }}>Buzzer</Text>
                </View>
                <Switch value={dev?.components?.buzzer ?? true} onValueChange={() => toggleComponent('buzzer')}
                  trackColor={{ false: theme.surface3, true: theme.warn + '40' }} thumbColor={dev?.components?.buzzer ? theme.warn : theme.textMuted} />
              </View>
            </SettingGroup>
         ) : null}

         {/* About */}
        <View style={{ alignItems: 'center', gap: 4, paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="shield-checkmark" size={16} color={theme.accent} />
            <Text style={{ fontSize: 14, fontWeight: '800', color: theme.accent }}>Coop+</Text>
            <Text style={{ fontSize: 12, color: theme.textMuted, fontWeight: '500' }}>v2.0</Text>
          </View>
          <Text style={{ fontSize: 12, color: theme.textMuted }}>Smart Coop Predator Defence System</Text>
        </View>
      </ScrollView>
    );
  }

  /* ─── MAIN RENDER ────────────────────────── */
  const TABS = [
    { key: 'home',     icon: 'home',     iconO: 'home-outline',     label: 'Home'    },
    { key: 'status',   icon: 'pulse',    iconO: 'pulse-outline',    label: 'Status'  },
    { key: 'history',  icon: 'time',     iconO: 'time-outline',     label: 'Activity' },
    { key: 'settings', icon: 'settings', iconO: 'settings-outline', label: 'Settings' },
  ];

  const screens = { home: renderHome, status: renderStatus, history: renderHistory, settings: renderSettings };

return (
    <ErrorBoundary>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <RNStatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

        <SafeAreaView style={{ flex: 1 }}>
          {onboarded ? (
            <>
              {/* ── HEADER ── */}
              <View style={[s.header, { borderBottomColor: theme.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="shield-checkmark" size={22} color={BRAND} />
                  <Text style={{ fontSize: 22, fontWeight: '900', color: theme.text, letterSpacing: -0.5 }}>Coop+</Text>
                  {connected && <View style={[s.connDot, { backgroundColor: theme.ok }]} />}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {/* Battery */}
                  {connected && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Ionicons name="battery-half" size={14} color={dev?.battery != null ? (dev.battery > 20 ? theme.ok : theme.danger) : theme.textMuted} />
                      <Text style={{ fontSize: 10, fontWeight: '700', color: dev?.battery != null ? (dev.battery > 20 ? theme.ok : theme.danger) : theme.textMuted }}>
                        {dev?.battery != null ? `${dev.battery}%` : '—'}
                      </Text>
                    </View>
                  )}
                  {/* Connection badge */}
                  <View style={[s.connBadge, { backgroundColor: connected ? theme.okDim : theme.surface2, borderColor: connected ? theme.ok + '40' : theme.border }]}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: connected ? theme.ok : theme.textMuted }} />
                    <Text style={{ fontSize: 11, fontWeight: '700', color: connected ? theme.ok : theme.textSub }}>
                      {connecting ? 'Connecting…' : connected ? 'Live' : 'Offline'}
                    </Text>
                  </View>
                  {/* Theme toggle */}
                  <TouchableOpacity
                    onPress={() => setThemeMode(m => m === 'dark' ? 'light' : 'dark')}
                    style={[s.themeBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
                    hitSlop={8} activeOpacity={0.7}
                  >
                    <Ionicons name={theme.dark ? 'sunny' : 'moon'} size={17} color={theme.dark ? BRAND : theme.text} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── CONTENT ── */}
              <View style={{ flex: 1, overflow: 'hidden', backgroundColor: theme.bg, position: 'relative' }}>
                {(screens[screen] || renderHome)()}
              </View>

              {/* ── TAB BAR ── */}
              <View style={[s.tabWrap, { paddingBottom: Platform.OS === 'ios' ? 0 : 10 }]}>
                <View style={[s.tabBar, { backgroundColor: theme.tab, borderColor: theme.border }]}>
                  {TABS.map(t => {
                    const active = screen === t.key;
                    return (
                      <TouchableOpacity key={t.key} onPress={() => setScreen(t.key)} style={s.tabItem} activeOpacity={0.75}>
                        <Ionicons name={active ? t.icon : t.iconO} size={22} color={active ? BRAND : theme.textMuted} />
                        <Text style={{ fontSize: 10, fontWeight: '700', marginTop: 2, color: active ? BRAND : theme.textMuted, letterSpacing: 0.2 }}>
                          {t.label}
                        </Text>
                        {active && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: BRAND, marginTop: 3 }} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </>
          ) : (
            <OnboardingScreen
              theme={theme}
              step={obStep}
              endpoint={endpoint}
              setEndpoint={setEndpoint}
              onNext={() => setObStep(s => Math.min(s + 1, SLIDES.length - 1))}
              onBack={() => setObStep(s => Math.max(s - 1, 0))}
              onSkip={() => { setOnboarded(true); setScreen('home'); }}
              onStart={async () => { setOnboarded(true); setScreen('home'); await connect(); }}
              onDetect={autoDetect}
              detecting={detecting}
            />
          )}
        </SafeAreaView>

        {/* Toast */}
        <Toast message={toast.msg} type={toast.type} theme={theme} />

        {/* Splash */}
        {splash && <SplashScreen onDone={() => setSplash(false)} />}
      </View>
    </ErrorBoundary>
  );
}

/* ─── SMALL COMPONENTS ────────────────────────────────────── */

function EventRow({ theme, ev, compact = false }) {
  const meta = useMemo(() => {
    if (ev.type === 'deterrent') return { icon: 'flash',           color: theme.danger };
    if (ev.type === 'pir')       return { icon: 'eye',             color: theme.warn  };
    if (ev.type === 'radar')     return { icon: 'radio',           color: theme.warn  };
    if (ev.type === 'arm')       return { icon: 'shield-checkmark',color: theme.ok    };
    return                              { icon: 'alert-circle',    color: theme.accent };
  }, [ev.type, theme]);

  return (
    <View style={[s.evCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[s.evIcon, { backgroundColor: meta.color + '1A' }]}>
        <Ionicons name={meta.icon} size={compact ? 15 : 18} color={meta.color} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: compact ? 13 : 14, fontWeight: '700', color: theme.text, flex: 1, marginRight: 8 }} numberOfLines={1}>
            {ev.title || ev.type}
          </Text>
          <Text style={{ fontSize: 10, color: theme.textMuted, fontWeight: '600' }}>{fmtRelative(ev.timestamp)}</Text>
        </View>
        {!compact && ev.details && (
          <Text style={{ fontSize: 12, color: theme.textSub, lineHeight: 17 }} numberOfLines={2}>{ev.details}</Text>
        )}
      </View>
    </View>
  );
}

function CmdRow({ theme, cmd, onDelete }) {
  return (
    <View style={[s.evCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[s.evIcon, { backgroundColor: theme.accentDim }]}>
        <Ionicons name={cmd.type === 'deterrent' ? 'flash' : 'lock-closed'} size={17} color={theme.accent} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
          {cmd.type === 'deterrent' ? 'Trigger Deterrent' : `Arm: ${cmd.payload || 'auto'}`}
        </Text>
        <Text style={{ fontSize: 11, color: theme.textMuted }}>
          {cmd.requestedBy || 'mobile'} · {fmtRelative(cmd.requestedAt)}
        </Text>
      </View>
      <TouchableOpacity onPress={onDelete} hitSlop={12} activeOpacity={0.6} style={{ padding: 6 }}>
        <Ionicons name="trash-outline" size={16} color={theme.danger} />
      </TouchableOpacity>
    </View>
  );
}

function EmptyState({ theme, icon, title, body }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 52, gap: 12 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.surface2, justifyContent: 'center', alignItems: 'center' }}>
        <Ionicons name={icon} size={32} color={theme.textMuted} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: '700', color: theme.textSub }}>{title}</Text>
      <Text style={{ fontSize: 14, color: theme.textMuted, textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>{body}</Text>
    </View>
  );
}

function SettingGroup({ theme, title, children }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textMuted, letterSpacing: 1 }}>{title}</Text>
      <View style={[s.card, { backgroundColor: theme.surface, gap: 10 }]}>{children}</View>
    </View>
  );
}

/* ─── STYLES ──────────────────────────────────────────────── */
const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14 },
  btnPrimary:     { borderRadius: 8, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  btnPrimaryTxt:  { fontSize: 16, fontWeight: '700', color: '#1A1A1A' },
  btnSecondary:   { borderRadius: 8, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnSecondaryTxt:{ fontSize: 15, fontWeight: '600' },
  
  /* Tactical Radar */
  radarContainer: {
    height: 180,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 4,
  },
  radarRing: {
    position: 'absolute',
    borderWidth: 1,
  },
  radarCrosshairH: {
    position: 'absolute',
    width: '90%',
    height: 1,
  },
  radarCrosshairV: {
    position: 'absolute',
    width: 1,
    height: '80%',
  },
  radarBlip: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radarBlipPulse: {
    width: 20,
    height: 20,
    borderRadius: 10,
    opacity: 0.35,
  },
  radarTextOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 14,
  },
});

const s = StyleSheet.create({
  /* Header */
  header: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:18,
    paddingTop: Platform.OS==='android' ? (RNStatusBar.currentHeight||24)+10 : 14, paddingBottom:14, borderBottomWidth:StyleSheet.hairlineWidth },
  connDot:   { width:7, height:7, borderRadius:3.5, marginLeft:2 },
  connBadge: { flexDirection:'row', alignItems:'center', gap:5, paddingHorizontal:10, paddingVertical:5, borderRadius:6, borderWidth:1 },
  themeBtn:  { width:35, height:35, borderRadius:8, borderWidth:1, alignItems:'center', justifyContent:'center' },
  /* Tab bar */
  tabWrap: { paddingHorizontal:14 },
  tabBar:  { flexDirection:'row', borderRadius:12, paddingVertical:6, paddingHorizontal:6,
    shadowOffset:{width:0,height:-3}, shadowOpacity:0.08, shadowRadius:16, elevation:10, borderWidth:StyleSheet.hairlineWidth },
  tabItem: { flex:1, alignItems:'center', paddingVertical:5 },
  /* Cards */
  card:    { borderRadius:10, padding:16 },
  heroCard:{ borderRadius:12, padding:16, shadowOffset:{width:0,height:4}, shadowOpacity:0.06, shadowRadius:18, elevation:4 },
  heroIconCircle: { width:72, height:72, borderRadius:36, alignItems:'center', justifyContent:'center' },
  /* Level bar */
  levelTrack: { flexDirection:'row', height:8, borderRadius:4, overflow:'hidden' },
  /* Chips */
  chip: { flex:1, flexDirection:'row', alignItems:'center', gap:12, padding:16, borderRadius:10, borderWidth:1 },
  /* Actions */
  actionBtn:       { borderRadius:8, paddingVertical:14, paddingHorizontal:18, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 },
  actionBtnTxt:    { fontSize:15, fontWeight:'700', color:'#1A1A1A' },
  actionBtnOutline:{ borderRadius:8, paddingVertical:12, paddingHorizontal:14, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:6, borderWidth:1.5 },
  actionBtnOutlineTxt: { fontSize:13, fontWeight:'700' },
  iconBtn: { width:50, height:50, borderRadius:8, borderWidth:1, alignItems:'center', justifyContent:'center' },
  /* Status rows */
  statusRow:  { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:12 },
  statusIcon: { width:30, height:30, borderRadius:6, alignItems:'center', justifyContent:'center' },
  /* History */
  segment: { flexDirection:'row', borderRadius:10, padding:3 },
  segItem: { flex:1, borderRadius:8, paddingVertical:10, alignItems:'center', flexDirection:'row', justifyContent:'center', gap:6 },
  evCard:  { borderWidth:1, borderRadius:10, padding:13, flexDirection:'row', alignItems:'center', gap:11 },
  evIcon:  { width:38, height:38, borderRadius:8, alignItems:'center', justifyContent:'center' },
  moreBtn: { borderRadius:8, paddingVertical:12, alignItems:'center' },
  /* Theme chips */
  themeChip: { borderRadius:8, borderWidth:1, paddingVertical:10, alignItems:'center', flexDirection:'row', justifyContent:'center', gap:6 },
  /* Toast */
  toast: { position:'absolute', top:60, left:18, right:18, flexDirection:'row', alignItems:'center', gap:8,
    borderRadius:8, paddingHorizontal:16, paddingVertical:12, zIndex:1000,
    shadowOffset:{width:0,height:4}, shadowOpacity:0.18, shadowRadius:12, elevation:12 },
});
