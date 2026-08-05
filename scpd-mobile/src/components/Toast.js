import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
      style={[styles.toast, { backgroundColor: bg, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}
    >
      <Ionicons
        name={type === 'error' ? 'close-circle' : type === 'ok' ? 'checkmark-circle' : 'information-circle'}
        size={16} color={tc}
      />
      <Text style={{ fontSize: 13, fontWeight: '600', color: tc, flex: 1 }}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', top: 60, left: 18, right: 18, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, zIndex: 1000, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 12 },
});

export default Toast;