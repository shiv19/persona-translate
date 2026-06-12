function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return buffer
}

async function blobToWav(blob: Blob): Promise<Blob> {
  const audioCtx = new AudioContext()
  const arrayBuffer = await blob.arrayBuffer()
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  const samples = audioBuffer.getChannelData(0)
  const wavBuffer = encodeWav(samples, audioBuffer.sampleRate)
  audioCtx.close()
  return new Blob([wavBuffer], { type: "audio/wav" })
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  console.log("[ASR] Input:", audioBlob.size, "bytes, type:", audioBlob.type)

  const wavBlob = await blobToWav(audioBlob)
  console.log("[ASR] WAV:", wavBlob.size, "bytes")

  const formData = new FormData()
  formData.append("model", "glm-asr-2512")
  formData.append("file", wavBlob, "recording.wav")
  formData.append("stream", "false")

  const response = await fetch("https://api.z.ai/api/coding/paas/v4/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_ZAI_API_KEY}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const err = await response.text()
    console.error("[ASR] Error:", response.status, err)
    throw new Error(`ASR ${response.status}: ${err}`)
  }

  const data = await response.json()
  console.log("[ASR] Response:", JSON.stringify(data))
  return data.text ?? ""
}
