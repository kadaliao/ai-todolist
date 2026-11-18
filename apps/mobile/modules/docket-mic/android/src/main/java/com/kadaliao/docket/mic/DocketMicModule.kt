package com.kadaliao.docket.mic

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Microphone capture for cloud speech recognition: 16 kHz mono 16-bit PCM in ~100 ms chunks
 * (`onAudio`, base64 + a 0…1 level), and a WAV copy of the whole take returned by `stop`.
 */
class DocketMicModule : Module() {
  private var record: AudioRecord? = null
  private var thread: Thread? = null
  @Volatile private var running = false
  private val pcm = ByteArrayOutputStream()

  override fun definition() = ModuleDefinition {
    Name("DocketMic")
    Events("onAudio", "onEnd")

    AsyncFunction("start") { begin() }

    AsyncFunction("stop") { finish(true) }

    Function("cancel") { finish(false) }

    OnDestroy { finish(false) }
  }

  @SuppressLint("MissingPermission")
  private fun begin() {
    if (running) finish(false)
    val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val rec = AudioRecord(
      MediaRecorder.AudioSource.VOICE_RECOGNITION,
      RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      max(min, CHUNK * 4),
    )
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      throw CodedException("MicBusy", "The microphone is not available.", null)
    }
    synchronized(pcm) { pcm.reset() }
    rec.startRecording()
    record = rec
    running = true
    thread = Thread {
      val buf = ByteArray(CHUNK)
      while (running) {
        var filled = 0
        while (running && filled < CHUNK) {
          val n = rec.read(buf, filled, CHUNK - filled)
          if (n <= 0) break
          filled += n
        }
        if (filled <= 0) {
          if (running) {
            running = false
            sendEvent("onEnd", mapOf("reason" to "error"))
          }
          break
        }
        synchronized(pcm) { pcm.write(buf, 0, filled) }
        sendEvent(
          "onAudio",
          mapOf("data" to Base64.encodeToString(buf, 0, filled, Base64.NO_WRAP), "level" to level(buf, filled)),
        )
      }
    }.also { it.start() }
  }

  private fun level(buf: ByteArray, len: Int): Double {
    val bb = ByteBuffer.wrap(buf, 0, len).order(ByteOrder.LITTLE_ENDIAN)
    var sum = 0.0
    val n = len / 2
    for (i in 0 until n) {
      val s = bb.short.toDouble() / 32768.0
      sum += s * s
    }
    val rms = sqrt(sum / max(n, 1))
    val db = 20 * log10(max(rms, 1e-6))
    return min(1.0, max(0.0, (db + 55) / 45))
  }

  private fun finish(keep: Boolean): Map<String, Any> {
    val rec = record ?: return emptyMap()
    running = false
    try {
      thread?.join(400)
    } catch (_: InterruptedException) {
    }
    thread = null
    try {
      rec.stop()
    } catch (_: IllegalStateException) {
    }
    rec.release()
    record = null
    val all = synchronized(pcm) { pcm.toByteArray().also { pcm.reset() } }
    if (!keep || all.isEmpty()) return emptyMap()
    val duration = all.size / 32000.0
    val dir = appContext.reactContext?.cacheDir ?: return mapOf("duration" to duration)
    val file = File(dir, "docket-mic-${UUID.randomUUID()}.wav")
    return try {
      file.writeBytes(wav(all))
      mapOf("uri" to "file://${file.absolutePath}", "duration" to duration)
    } catch (_: Exception) {
      mapOf("duration" to duration)
    }
  }

  private fun wav(data: ByteArray): ByteArray {
    val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    h.put("RIFF".toByteArray()).putInt(36 + data.size).put("WAVEfmt ".toByteArray())
    h.putInt(16).putShort(1).putShort(1).putInt(RATE).putInt(RATE * 2).putShort(2).putShort(16)
    h.put("data".toByteArray()).putInt(data.size)
    return h.array() + data
  }

  companion object {
    const val RATE = 16000
    /** 100 ms of 16 kHz 16-bit mono. */
    const val CHUNK = 3200
  }
}
