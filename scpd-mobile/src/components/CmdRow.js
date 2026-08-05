import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

function CmdRow({ theme, cmd, onDelete }) {
  return (
    <View style={[styles.evCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.evIcon, { backgroundColor: theme.accentDim }]}>
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

export default CmdRow;