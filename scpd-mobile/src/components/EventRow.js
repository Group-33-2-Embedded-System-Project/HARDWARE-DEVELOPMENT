import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

function EventRow({ theme, ev, compact = false }) {
  const meta = useMemo(() => {
    if (ev.type === 'deterrent') return { icon: 'flash', color: theme.danger };
    if (ev.type === 'pir') return { icon: 'eye', color: theme.warn };
    if (ev.type === 'radar') return { icon: 'radio', color: theme.warn };
    if (ev.type === 'arm') return { icon: 'shield-checkmark', color: theme.ok };
    return { icon: 'alert-circle', color: theme.accent };
  }, [ev.type, theme]);

  return (
    <View style={[styles.evCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.evIcon, { backgroundColor: meta.color + '1A' }]}>
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

function fmtRelative(ms) {
  if (!ms) return '';
  const diff = Date.now() - Number(ms);
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const styles = StyleSheet.create({
  evCard: { borderWidth: 1, borderRadius: 10, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  evIcon: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});

export default EventRow;