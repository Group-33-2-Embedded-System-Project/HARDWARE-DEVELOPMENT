import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

function SettingGroup({ theme, title, children }) {
  return (
    <View style={styles.wrap}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textMuted, letterSpacing: 1 }}>{title}</Text>
      <View style={[styles.card, { backgroundColor: theme.surface, gap: 10 }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  card: { borderRadius: 10, padding: 16 },
});

export default SettingGroup;