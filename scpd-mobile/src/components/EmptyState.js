import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

function EmptyState({ theme, icon, title, body }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={32} color={theme.textMuted} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: '700', color: theme.textSub }}>{title}</Text>
      <Text style={{ fontSize: 14, color: theme.textMuted, textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 52, gap: 12 },
  iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#E5E5EA', justifyContent: 'center', alignItems: 'center' },
});

export default EmptyState;