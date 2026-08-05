import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
    <Animated.View style={[styles.chip, { backgroundColor: bgColor, borderColor: active ? color + '30' : theme.border }]}>
      <Ionicons name={icon} size={20} color={color} style={{ marginRight: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</Text>
        <Text style={{ fontSize: 15, fontWeight: '800', color }}>{value}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 10, borderWidth: 1 },
});

export default SensorChip;