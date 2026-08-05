import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BRAND } from '../theme';

function TacticalRadar({ theme, active, radarActive, pirActive }) {
  const sweepAnim = useRef(new Animated.Value(0)).current;
  const blipOpacity = useRef(new Animated.Value(0)).current;

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
      <View style={[styles.radarRing, { width: 40, height: 40, borderRadius: 20, borderColor: radarColor + '10' }]} />
      <View style={[styles.radarRing, { width: 90, height: 90, borderRadius: 45, borderColor: radarColor + '15' }]} />
      <View style={[styles.radarRing, { width: 140, height: 140, borderRadius: 70, borderColor: radarColor + '20' }]} />
      <View style={[styles.radarCrosshairH, { backgroundColor: radarColor + '10' }]} />
      <View style={[styles.radarCrosshairV, { backgroundColor: radarColor + '10' }]} />

      <Animated.View style={[{ position: 'absolute', width: 140, height: 140, justifyContent: 'center', alignItems: 'center', transform: [{ rotate }] }]}>
        <View style={{ position: 'absolute', width: 70, height: 2, backgroundColor: radarColor, opacity: 0.35, left: 70 }} />
      </Animated.View>

      {radarActive && (
        <Animated.View style={[styles.radarBlip, { backgroundColor: blipColor, top: '25%', left: '65%', opacity: blipOpacity }]}>
          <View style={[styles.radarBlipPulse, { backgroundColor: blipColor }]} />
        </Animated.View>
      )}

      {pirActive && (
        <Animated.View style={[styles.radarBlip, { backgroundColor: theme.danger, top: '60%', left: '35%', opacity: blipOpacity }]}>
          <View style={[styles.radarBlipPulse, { backgroundColor: theme.danger }]} />
        </Animated.View>
      )}

      <View style={styles.radarTextOverlay}>
        {!active ? (
          <Text style={{ fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: 'bold', color: radarColor, opacity: 0.65 }}>
            ⚡ OFFLINE
          </Text>
        ) : radarActive || pirActive ? (
          <Text style={{ fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: 'bold', color: radarColor, opacity: 0.65 }}>
            ⚠️ TARGET DETECTED
          </Text>
        ) : (
          <Text style={{ fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: 'bold', color: radarColor, opacity: 0.65 }}>
            📡 SCANNING ACTIVE
          </Text>
        )}
        {active && (
          <Text style={{ fontSize: 8, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: radarColor, opacity: 0.45, marginTop: 2 }}>
            RCWL-0516 · {radarActive ? 'ACTIVE' : 'STANDBY'} · {pirActive ? 'PIR ALERT' : 'RADAR ONLY'}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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

export default TacticalRadar;