extends Node2D
## Unit — Visual representation and runtime state for a single unit on the board.

# Visual components (created in code)
var _sprite: Sprite2D
var _hp_bar: ColorRect
var _hp_bar_bg: ColorRect
var _mana_bar: ColorRect
var _mana_bar_bg: ColorRect
var _name_label: Label
var _info_label: Label

# Element colors for tinting
const ELEMENT_COLORS: Dictionary = {
	"fire": Color(0.9, 0.25, 0.15),
	"water": Color(0.2, 0.5, 0.9),
	"earth": Color(0.55, 0.4, 0.2),
	"storm": Color(0.9, 0.85, 0.2),
	"light": Color(1.0, 0.95, 0.7),
	"void": Color(0.5, 0.15, 0.6)
}

const ROLE_SHAPES: Dictionary = {
	"vanguard": "shield",
	"duelist": "sword",
	"ranger": "arrow",
	"caster": "star",
	"bruiser": "diamond",
	"support": "cross"
}


func _ready() -> void:
	_create_visuals()


func _create_visuals() -> void:
	# Background shape
	_sprite = Sprite2D.new()
	add_child(_sprite)

	# Name label above unit
	_name_label = Label.new()
	_name_label.position = Vector2(-35, -45)
	_name_label.add_theme_font_size_override("font_size", 9)
	_name_label.add_theme_color_override("font_color", Color.WHITE)
	add_child(_name_label)

	# Info label (attack type / element)
	_info_label = Label.new()
	_info_label.position = Vector2(-35, 30)
	_info_label.add_theme_font_size_override("font_size", 7)
	_info_label.add_theme_color_override("font_color", Color(0.8, 0.8, 0.8))
	add_child(_info_label)

	# HP bar background
	_hp_bar_bg = ColorRect.new()
	_hp_bar_bg.size = Vector2(50, 5)
	_hp_bar_bg.position = Vector2(-25, -35)
	_hp_bar_bg.color = Color(0.2, 0.2, 0.2)
	add_child(_hp_bar_bg)

	# HP bar fill
	_hp_bar = ColorRect.new()
	_hp_bar.size = Vector2(50, 5)
	_hp_bar.position = Vector2(-25, -35)
	_hp_bar.color = Color(0.2, 0.8, 0.2)
	add_child(_hp_bar)

	# Mana bar background
	_mana_bar_bg = ColorRect.new()
	_mana_bar_bg.size = Vector2(50, 3)
	_mana_bar_bg.position = Vector2(-25, -29)
	_mana_bar_bg.color = Color(0.15, 0.15, 0.3)
	add_child(_mana_bar_bg)

	# Mana bar fill
	_mana_bar = ColorRect.new()
	_mana_bar.size = Vector2(0, 3)
	_mana_bar.position = Vector2(-25, -29)
	_mana_bar.color = Color(0.3, 0.5, 1.0)
	add_child(_mana_bar)


## Set up the unit from a data dictionary
func setup_from_data(data: Dictionary, is_player: bool) -> void:
	# Store all stats as metadata
	for key in data:
		set_meta(key, data[key])

	set_meta("is_player", is_player)
	set_meta("current_hp", data.get("hp", 100))
	set_meta("max_hp", data.get("hp", 100))
	set_meta("current_mana", 0.0)
	set_meta("attack_cooldown", 0.0)
	set_meta("stunned", false)
	set_meta("shield", 0.0)

	# Visuals
	_name_label.text = data.get("name", "Unit")
	var element: String = data.get("element", "fire")
	var atk_type: String = data.get("attack_type", "")
	_info_label.text = "%s / %s" % [atk_type.capitalize(), element.capitalize()]

	# Global cache for processed textures to prevent severe lag spikes
	var unit_id = data.get("id", "default")
	if UnitData.has_method("get_cached_texture") and UnitData.call("get_cached_texture", unit_id) != null:
		_sprite.texture = UnitData.call("get_cached_texture", unit_id)
		var scale_val = UnitData.call("get_cached_scale", unit_id)
		_sprite.scale = Vector2(scale_val, scale_val)
	else:
		# Load sprite via byte detection — files are JPEG with .png extensions
		var sprite_res_path := "res://sprites/%s.png" % unit_id
		var sprite_abs_path := ProjectSettings.globalize_path(sprite_res_path)
		var spr_img := Image.new()

		var spr_file := FileAccess.open(sprite_abs_path, FileAccess.READ)
		if spr_file:
			var spr_bytes := spr_file.get_buffer(spr_file.get_length())
			spr_file.close()

			# Detect format from magic bytes
			if spr_bytes.size() >= 3 and spr_bytes[0] == 0xFF and spr_bytes[1] == 0xD8:
				spr_img.load_jpg_from_buffer(spr_bytes)
			elif spr_bytes.size() >= 4 and spr_bytes[0] == 0x52 and spr_bytes[1] == 0x49:
				spr_img.load_webp_from_buffer(spr_bytes)
			elif spr_bytes.size() >= 8 and spr_bytes[0] == 0x89 and spr_bytes[1] == 0x50:
				spr_img.load_png_from_buffer(spr_bytes)

		if not spr_img.is_empty():
			# JPEG has no alpha — remove background
			_remove_background(spr_img)

			var new_tex := ImageTexture.create_from_image(spr_img)
			_sprite.texture = new_tex

			# Scale to fit within the grid cell (target ~60px)
			var target_px := 60.0
			var max_dim := maxf(float(spr_img.get_width()), float(spr_img.get_height()))
			var s := target_px / max_dim
			_sprite.scale = Vector2(s, s)

			# Store in cache
			if UnitData.has_method("set_cached_texture"):
				UnitData.call("set_cached_texture", unit_id, new_tex, s)
		else:
			_draw_placeholder(element, is_player)

	# Flip or tint for enemy
	if not is_player:
		modulate = modulate.darkened(0.15)

	# Start idle bobbing animation
	_start_idle_animation()


## Returns a dictionary of all stats stored in metadata
func get_data_dict() -> Dictionary:
	var dict = {}
	for key in get_meta_list():
		dict[key] = get_meta(key)
	return dict


## Fallback background removal algorithm using flood-fill.
## Samples corner pixels for bg color, then flood-fills from all edges
## removing only connected outer background pixels.
func _remove_background(img: Image) -> void:
	if img.get_format() != Image.FORMAT_RGBA8:
		img.convert(Image.FORMAT_RGBA8)
	var w := img.get_width()
	var h := img.get_height()

	# Sample corners and edges to detect background color
	var samples: Array[Color] = []
	for pos in [Vector2i(0,0), Vector2i(w-1,0), Vector2i(0,h-1), Vector2i(w-1,h-1),
				 Vector2i(int(w/2.0),0), Vector2i(int(w/2.0),h-1), Vector2i(0,int(h/2.0)), Vector2i(w-1,int(h/2.0))]:
		samples.append(img.get_pixelv(pos))
		
	# Pre-compute thresholds
	var threshold := 0.28  # Slightly wider because of gradients
	var edge_threshold := 0.12

	# Flood fill from all border pixels
	var visited := {}  # Vector2i -> true
	var queue: Array[Vector2i] = []

	# Seed the queue with all edge pixels
	for x in w:
		queue.append(Vector2i(x, 0))
		queue.append(Vector2i(x, h - 1))
	for y in h:
		queue.append(Vector2i(0, y))
		queue.append(Vector2i(w - 1, y))

	while not queue.is_empty():
		var pos: Vector2i = queue.pop_back()
		if visited.has(pos):
			continue
		if pos.x < 0 or pos.x >= w or pos.y < 0 or pos.y >= h:
			continue
		visited[pos] = true

		var px := img.get_pixel(pos.x, pos.y)
		var min_dist := INF
		for sample in samples:
			var dr := px.r - sample.r
			var dg := px.g - sample.g
			var db := px.b - sample.b
			var dist := sqrt(dr*dr + dg*dg + db*db)
			if dist < min_dist:
				min_dist = dist

		if min_dist < threshold:
			# This pixel is background — make transparent
			img.set_pixel(pos.x, pos.y, Color(0, 0, 0, 0))
			# Continue flood filling to neighbors
			for d in [Vector2i(1,0), Vector2i(-1,0), Vector2i(0,1), Vector2i(0,-1)]:
				var np: Vector2i = pos + d
				if not visited.has(np):
					queue.append(np)
		elif min_dist < threshold + edge_threshold:
			# Edge pixel — semi-transparent for anti-aliasing
			var alpha_factor := (min_dist - threshold) / edge_threshold
			img.set_pixel(pos.x, pos.y, Color(px.r, px.g, px.b, alpha_factor))


## Start a looping idle bob animation on the sprite
func _start_idle_animation() -> void:
	if _sprite == null:
		return
	var base_y := _sprite.position.y
	var tween := create_tween()
	tween.set_loops()  # Loop forever
	tween.tween_property(_sprite, "position:y", base_y - 3.0, 0.6).set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	tween.tween_property(_sprite, "position:y", base_y + 3.0, 0.6).set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	tween.tween_property(_sprite, "position:y", base_y, 0.6).set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)

func _draw_placeholder(element: String, is_player: bool) -> void:
	# Create a simple colored square as placeholder
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	var base_color: Color = ELEMENT_COLORS.get(element, Color.GRAY)
	if not is_player:
		base_color = base_color.darkened(0.3)

	# Fill with element color
	img.fill(base_color)

	# Add border
	for x in 64:
		for y in 64:
			if x < 2 or x >= 62 or y < 2 or y >= 62:
				img.set_pixel(x, y, Color.WHITE if is_player else Color(0.8, 0.2, 0.2))

	var tex := ImageTexture.create_from_image(img)
	_sprite.texture = tex
	_sprite.scale = Vector2(0.8, 0.8)


## Update HP bar display
func update_hp_bar() -> void:
	var current_hp: float = get_meta("current_hp", 0)
	var max_hp: float = get_meta("max_hp", 1)
	var ratio := clampf(current_hp / max_hp, 0.0, 1.0)
	_hp_bar.size.x = 50 * ratio

	# Color: green -> yellow -> red
	if ratio > 0.5:
		_hp_bar.color = Color(0.2, 0.8, 0.2)
	elif ratio > 0.25:
		_hp_bar.color = Color(0.9, 0.7, 0.1)
	else:
		_hp_bar.color = Color(0.9, 0.2, 0.1)

	# Update mana bar too
	var current_mana: float = get_meta("current_mana", 0)
	var max_mana: float = get_meta("mana_max", 100)
	var mana_ratio := clampf(current_mana / max_mana, 0.0, 1.0)
	_mana_bar.size.x = 50 * mana_ratio


## Flash red when hit
func flash_hit() -> void:
	var orig_color := modulate
	modulate = Color.RED
	var tween := create_tween()
	tween.tween_property(self, "modulate", orig_color, 0.2)


## Flash blue when casting
func flash_cast() -> void:
	var orig_color := modulate
	modulate = Color.CYAN
	var tween := create_tween()
	tween.tween_property(self, "modulate", orig_color, 0.3)


## Attack lunge animation — unit bounces toward target then back
func attack_lunge(target_pos: Vector2) -> void:
	var dir := (target_pos - position).normalized()
	var lunge_offset := dir * 15.0
	var tween := create_tween()
	tween.tween_property(self, "position", position + lunge_offset, 0.08)
	tween.tween_property(self, "position", position, 0.08)


## Ranged attack — spawn a projectile that flies to target with VFX trail
func ranged_attack(target_global_pos: Vector2, element: String) -> void:
	var proj_base := Node2D.new()
	proj_base.position = position
	get_parent().add_child(proj_base)
	
	var color: Color = ELEMENT_COLORS.get(element, Color.WHITE)
	
	# Core projectile (overbright for Glow)
	var rect := ColorRect.new()
	rect.size = Vector2(8, 8)
	rect.position = Vector2(-4, -4)
	rect.color = color * 1.5 
	proj_base.add_child(rect)

	# Particle Trail
	var parts := CPUParticles2D.new()
	parts.amount = 20
	parts.lifetime = 0.3
	parts.emission_shape = CPUParticles2D.EMISSION_SHAPE_SPHERE
	parts.emission_sphere_radius = 4.0
	parts.gravity = Vector2.ZERO
	parts.local_coords = false 
	parts.scale_amount_min = 3.0
	parts.scale_amount_max = 7.0
	var grad := Gradient.new()
	grad.add_point(0.0, color * 1.2)
	grad.add_point(1.0, color * Color(1,1,1,0))
	parts.color_ramp = grad
	proj_base.add_child(parts)

	var tween := create_tween()
	tween.tween_property(proj_base, "position", target_global_pos, 0.25)
	
	# Wait for particles to fade before deleting 
	tween.tween_callback(func():
		rect.hide()
		parts.emitting = false
	)
	tween.tween_interval(0.3)
	tween.tween_callback(proj_base.queue_free)


## Smooth slide to a new position on the grid
func slide_to(target_pos: Vector2) -> void:
	var tween := create_tween()
	tween.tween_property(self, "position", target_pos, 0.15).set_ease(Tween.EASE_OUT)
