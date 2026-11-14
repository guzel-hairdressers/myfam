// Relay packets contain 40 ms of 16 kHz mono PCM16 with simple high-pass + noise gate.
class RelayAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.packet = new ArrayBuffer(1280);
    this.view = new DataView(this.packet);
    this.offset = 0;

    // Simple 1st-order high-pass state (~90 Hz cutoff) to remove room rumble
    this.prevIn = 0;
    this.prevOut = 0;

    // Smooth noise gate + anti-howl state
    this.gateGain = 0;
    this.holdSamples = 0;
    this.howlSamples = 0;
    this.howlGain = 1;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const len = channels[0].length;

    // Measure block RMS to decide whether voice or sustained howl is present
    let sqSum = 0;
    for (let i = 0; i < len; i++) {
      let sample = 0;
      for (const ch of channels) sample += ch[i];
      sample /= channels.length;
      sqSum += sample * sample;
    }
    const rms = Math.sqrt(sqSum / len);
    const gateOpen = rms > 0.015; // Suppresses low-level room hum / hiss
    if (gateOpen) this.holdSamples = Math.round(sampleRate * 0.22); // 220ms holdover tail

    // Sustained high-energy input (>200ms) indicates acoustic feedback howling; duck it
    if (rms > 0.22) {
      this.howlSamples = Math.min(sampleRate, this.howlSamples + len);
    } else {
      this.howlSamples = Math.max(0, this.howlSamples - len * 2);
    }
    const targetHowlGain = this.howlSamples > sampleRate * 0.2 ? 0.2 : 1;

    for (let i = 0; i < len; i++) {
      let sample = 0;
      for (const ch of channels) sample += ch[i];
      sample /= channels.length;

      // High-pass filter
      const hp = 0.96 * (this.prevOut + sample - this.prevIn);
      this.prevIn = sample;
      this.prevOut = hp;

      // Smooth gate + anti-howl envelope (true silence when gate closed)
      const targetGain = this.holdSamples > 0 ? 1 : 0;
      if (this.holdSamples > 0) this.holdSamples--;
      this.gateGain += (targetGain - this.gateGain) * 0.02;
      this.howlGain += (targetHowlGain - this.howlGain) * 0.005;

      this.sum += hp * this.gateGain * this.howlGain;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.view.setInt16(this.offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
        this.offset += 2;
        this.sum = 0;
        this.count = 0;
        if (this.offset === this.packet.byteLength) {
          this.port.postMessage(this.packet, [this.packet]);
          this.packet = new ArrayBuffer(1280);
          this.view = new DataView(this.packet);
          this.offset = 0;
        }
      }
    }
    // Outputs stay at zero; never play the local microphone through speakers.
    return true;
  }
}
registerProcessor('relay-audio', RelayAudioProcessor);
