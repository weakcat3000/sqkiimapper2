extends Node
## AudioManager — Procedural sound effects and background music for Countered.

var _bgm_player: AudioStreamPlayer
var _sfx_player: AudioStreamPlayer

# Cached sounds
var _sfx_attack_melee: AudioStreamWAV
var _sfx_attack_ranged: AudioStreamWAV
var _sfx_hit: AudioStreamWAV
var _sfx_skill: AudioStreamWAV
var _sfx_death: AudioStreamWAV
var _sfx_buy: AudioStreamWAV
var _bgm_stream: AudioStreamWAV

const SAMPLE_RATE: int = 22050


func _ready() -> void:
	# Create audio players
	_bgm_player = AudioStreamPlayer.new()
	_bgm_player.bus = "Master"
	_bgm_player.volume_db = -12.0
	add_child(_bgm_player)

	_sfx_player = AudioStreamPlayer.new()
	_sfx_player.bus = "Master"
	add_child(_sfx_player)

	# Generate all sound effects
	_sfx_attack_melee = _gen_melee_sound()
	_sfx_attack_ranged = _gen_ranged_sound()
	_sfx_hit = _gen_hit_sound()
	_sfx_skill = _gen_skill_sound()
	_sfx_death = _gen_death_sound()
	_sfx_buy = _gen_buy_sound()
	_bgm_stream = _gen_bgm()

	# Start background music
	_bgm_player.stream = _bgm_stream
	_bgm_player.play()


## Play a named sound effect
func play_sfx(sfx_name: String) -> void:
	var stream: AudioStreamWAV = null
	match sfx_name:
		"melee":
			stream = _sfx_attack_melee
		"ranged":
			stream = _sfx_attack_ranged
		"hit":
			stream = _sfx_hit
		"skill":
			stream = _sfx_skill
		"death":
			stream = _sfx_death
		"buy":
			stream = _sfx_buy
	if stream:
		# Create a temporary player so sounds can overlap
		var player := AudioStreamPlayer.new()
		player.stream = stream
		player.volume_db = -6.0
		add_child(player)
		player.play()
		player.finished.connect(player.queue_free)


## Generate a short melee attack whoosh
func _gen_melee_sound() -> AudioStreamWAV:
	var frames := int(SAMPLE_RATE * 0.15)
	var data := PackedByteArray()
	data.resize(frames * 2)
	for i in frames:
		var t := float(i) / SAMPLE_RATE
		var env := 1.0 - float(i) / frames
		# Noise-like whoosh with descending pitch
		var freq := 400.0 - t * 1500.0
		var val := sin(t * freq * TAU) * env * 0.4
		val += (randf() - 0.5) * env * 0.3  # Add noise
		var s := int(clamp(val, -1.0, 1.0) * 32767)
		data[i * 2] = s & 0xFF
		data[i * 2 + 1] = (s >> 8) & 0xFF
	return _make_wav(data)


## Generate a ranged projectile pew sound
func _gen_ranged_sound() -> AudioStreamWAV:
	var frames := int(SAMPLE_RATE * 0.2)
	var data := PackedByteArray()
	data.resize(frames * 2)
	for i in frames:
		var t := float(i) / SAMPLE_RATE
		var env := (1.0 - float(i) / frames) * 0.5
		var freq := 800.0 + t * 1200.0  # Rising pitch
		var val := sin(t * freq * TAU) * env
		var s := int(clamp(val, -1.0, 1.0) * 32767)
		data[i * 2] = s & 0xFF
		data[i * 2 + 1] = (s >> 8) & 0xFF
	return _make_wav(data)


## Generate a hit impact thud
func _gen_hit_sound() -> AudioStreamWAV:
	var frames := int(SAMPLE_RATE * 0.1)
	var data := PackedByteArray()
	data.resize(frames * 2)
	for i in frames:
		var t := float(i) / SAMPLE_RATE
		var env := (1.0 - float(i) / frames) ** 2
		var freq := 150.0 - t * 500.0
		var val := sin(t * freq * TAU) * env * 0.6
		val += (randf() - 0.5) * env * 0.2
		var s := int(clamp(val, -1.0, 1.0) * 32767)
		data[i * 2] = s & 0xFF
		data[i * 2 + 1] = (s >> 8) & 0xFF
	return _make_wav(data)


## Generate a magical skill cast sound
func _gen_skill_sound() -> AudioStreamWAV:
	var frames := int(SAMPLE_RATE * 0.4)
	var data := PackedByteArray()
	data.resize(frames * 2)
	for i in frames:
		var t := float(i) / SAMPLE_RATE
		var env := sin(float(i) / frames * PI) * 0.4
		var val := sin(t * 600.0 * TAU) * env
		val += sin(t * 900.0 * TAU) * env * 0.5
		val += sin(t * 1200.0 * TAU) * env * 0.25
		var s := int(clamp(val, -1.0, 1.0) * 32767)
		data[i * 2] = s & 0xFF
		data[i * 2 + 1] = (s >> 8) & 0xFF
	return _make_wav(data)


## Generate a death/defeat sound
func _gen_death_sound() -> AudioStreamWAV:
	var frames := int(SAMPLE_RATE * 0.3)
	var data := PackedByteArray()
	data.resize(frames * 2)
	for i in frames:
		var t := float(i) / SAMPLE_RATE
		var env := (1.0 - float(i) / frames)
		var freq := 300.0 - t * 800.0  # Descending
		var val := sin(t * freq * TAU) * env * 0.5
		val += (randf() - 0.5) * env * 0.15
		var s := int(clamp(val, -1.0, 1.0) * 32767)
		data[i * 2] = s & 0xFF
		data[i * 2 + 1] = (s >> 8) & 0xFF
	return _make_wav(data)


## Generate a buy/purchase chime
func _gen_buy_sound() -> AudioStreamWAV:
	var frames := int(SAMPLE_RATE * 0.2)
	var data := PackedByteArray()
	data.resize(frames * 2)
	for i in frames:
		var t := float(i) / SAMPLE_RATE
		var env := (1.0 - float(i) / frames) * 0.3
		# Two-tone chime: C5 then E5
		var freq := 523.0 if t < 0.1 else 659.0
		var val := sin(t * freq * TAU) * env
		var s := int(clamp(val, -1.0, 1.0) * 32767)
		data[i * 2] = s & 0xFF
		data[i * 2 + 1] = (s >> 8) & 0xFF
	return _make_wav(data)


## Generate ambient background music loop (dark ambient drone)
func _gen_bgm() -> AudioStreamWAV:
	var duration := 8.0  # 8-second loop
	var frames := int(SAMPLE_RATE * duration)
	var data := PackedByteArray()
	data.resize(frames * 2)
	for i in frames:
		var t := float(i) / SAMPLE_RATE
		var val := 0.0
		# Low drone
		val += sin(t * 55.0 * TAU) * 0.15
		val += sin(t * 82.5 * TAU) * 0.08
		# Ethereal pad (slow LFO modulated)
		var lfo := sin(t * 0.3 * TAU) * 0.5 + 0.5
		val += sin(t * 220.0 * TAU) * 0.04 * lfo
		val += sin(t * 330.0 * TAU) * 0.03 * (1.0 - lfo)
		# Subtle shimmer
		val += sin(t * 440.0 * TAU) * 0.02 * sin(t * 0.7 * TAU)
		var s := int(clamp(val, -1.0, 1.0) * 32767)
		data[i * 2] = s & 0xFF
		data[i * 2 + 1] = (s >> 8) & 0xFF

	var wav := _make_wav(data)
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_begin = 0
	wav.loop_end = frames
	return wav


## Helper to create an AudioStreamWAV from raw PCM16 data
func _make_wav(data: PackedByteArray) -> AudioStreamWAV:
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = SAMPLE_RATE
	wav.stereo = false
	wav.data = data
	return wav
