extends Control
## Main — Root game controller. Manages prep/battle/reward phases.

enum GamePhase { PREP, BATTLE, REWARD, GAME_OVER }
var _phase: GamePhase = GamePhase.PREP

var _gold: int = 10
var _round: int = 1
var _player_hp: int = 100
var _board_units: Array = []  # Player units currently on board

var _last_battle_won: bool = false
var _last_battle_units_remaining: int = 0

const MAX_BOARD_UNITS: int = 5
const STARTING_GOLD: int = 10
const GOLD_PER_ROUND: int = 5

# Child references
@onready var _battle_board: Node2D = $BattleBoard
@onready var _shop: PanelContainer = $UILayer/BottomPanel/Shop
@onready var _hud: PanelContainer = $UILayer/TopPanel/HUD
@onready var _bench: PanelContainer = $UILayer/BottomPanel/Bench

var _selected_bench_index: int = -1
var _placing_unit_data: Dictionary = {}
var _prep_time_remaining: float = 60.0
var _tooltip_ui: PanelContainer
var _last_hovered_unit: Node2D = null
var _ui_hover_active: bool = false


func _ready() -> void:
	randomize()

	# ── Load background image ──
	_load_background()

	# ── Connect signals ──
	_shop.unit_purchased.connect(_on_unit_purchased)
	_hud.start_battle_pressed.connect(_on_start_battle)
	_bench.unit_selected.connect(_on_bench_unit_selected)
	_battle_board.battle_ended.connect(_on_battle_ended)

	# ── Tooltip UI ──
	_tooltip_ui = preload("res://scripts/tooltip_ui.gd").new()
	$UILayer.add_child(_tooltip_ui)
	_shop.unit_hovered.connect(_on_tooltip_show)
	_shop.unit_unhovered.connect(_on_tooltip_hide)
	_bench.unit_hovered.connect(_on_tooltip_show)
	_bench.unit_unhovered.connect(_on_tooltip_hide)

	# ── Post-Processing Glow ──
	var env := Environment.new()
	env.background_mode = Environment.BG_CANVAS
	env.glow_enabled = true
	env.glow_intensity = 1.2
	env.glow_strength = 1.0
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	# ── Camera ──
	var cam := Camera2D.new()
	cam.name = "MainCamera"
	cam.position = Vector2(640, 360)
	add_child(cam)

	# ── Start the game ──
	_update_ui()
	# Use call_deferred so all children have finished _ready first
	call_deferred("_enter_prep_phase")


func _load_background() -> void:
	var bg_path := "res://sprites/bg_void_realm.png"
	var bg_abs := ProjectSettings.globalize_path(bg_path)

	var bg_img := Image.new()
	var f := FileAccess.open(bg_abs, FileAccess.READ)
	if f:
		var bytes := f.get_buffer(f.get_length())
		f.close()

		# Detect format from magic bytes (files are JPEG with .png extension)
		if bytes.size() >= 3 and bytes[0] == 0xFF and bytes[1] == 0xD8:
			bg_img.load_jpg_from_buffer(bytes)
		elif bytes.size() >= 4 and bytes[0] == 0x52 and bytes[1] == 0x49:
			bg_img.load_webp_from_buffer(bytes)
		elif bytes.size() >= 8 and bytes[0] == 0x89 and bytes[1] == 0x50:
			bg_img.load_png_from_buffer(bytes)

	if not bg_img.is_empty():
		$Background.texture = ImageTexture.create_from_image(bg_img)
	else:
		push_warning("Could not load background image: %s" % bg_abs)


# ═══════════════════════════════════════════════════════════
#  TOOLTIP
# ═══════════════════════════════════════════════════════════

func _on_tooltip_show(data: Dictionary) -> void:
	_ui_hover_active = true
	if _tooltip_ui:
		_tooltip_ui.show_tooltip(data)

func _on_tooltip_hide() -> void:
	_ui_hover_active = false
	if _tooltip_ui:
		_tooltip_ui.hide_tooltip()


# ═══════════════════════════════════════════════════════════
#  PROCESS LOOP
# ═══════════════════════════════════════════════════════════

func _process(delta: float) -> void:
	# Hover tooltip over board units
	if not _ui_hover_active:
		var m_pos = get_global_mouse_position() - _battle_board.global_position
		var grid_pos = _battle_board.world_to_grid(m_pos)
		var hovered_unit = _battle_board.get_unit_at(grid_pos)

		if hovered_unit != null and is_instance_valid(hovered_unit) and hovered_unit.has_method("get_data_dict"):
			if hovered_unit != _last_hovered_unit:
				_last_hovered_unit = hovered_unit
				if _tooltip_ui:
					_tooltip_ui.show_tooltip(hovered_unit.get_data_dict())
		else:
			if _last_hovered_unit != null:
				_last_hovered_unit = null
				if _tooltip_ui:
					_tooltip_ui.hide_tooltip()
	else:
		_last_hovered_unit = null

	# Prep phase timer countdown
	if _phase == GamePhase.PREP:
		if _prep_time_remaining > 0:
			_prep_time_remaining -= delta
			_hud.update_timer(_prep_time_remaining)
			if _prep_time_remaining <= 0:
				_prep_time_remaining = 0
				# Timer ran out — force battle if player has units, otherwise extend
				if not _board_units.is_empty():
					_enter_battle_phase()
				else:
					# Give more time if no units placed
					_prep_time_remaining = 30.0
					print("No units placed! Timer extended.")


func _input(event: InputEvent) -> void:
	if _phase != GamePhase.PREP:
		return
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if not _placing_unit_data.is_empty():
			_try_place_unit(event.position)


# ═══════════════════════════════════════════════════════════
#  UI UPDATE
# ═══════════════════════════════════════════════════════════

func _update_ui() -> void:
	_hud.update_gold(_gold)
	_hud.update_round(_round)
	_hud.update_health(_player_hp)


# ═══════════════════════════════════════════════════════════
#  PHASE MANAGEMENT (Simple State Machine)
# ═══════════════════════════════════════════════════════════

func _enter_prep_phase() -> void:
	_phase = GamePhase.PREP
	_prep_time_remaining = 60.0
	_hud.set_phase("Preparation")
	_shop.refresh_shop()
	_shop.visible = true
	_bench.visible = true
	_hud.set_battle_button_enabled(_board_units.size() > 0)

	# Spawn enemies so the player can scout them during prep
	_battle_board.spawn_enemy_round(_round)
	print("=== PREP PHASE — Round %d ===" % _round)
	print("  Enemies spawned: %d" % _battle_board._enemy_units.size())


func _on_start_battle() -> void:
	if _phase != GamePhase.PREP:
		return
	if _board_units.is_empty():
		print("Place at least one unit before starting battle!")
		return
	_enter_battle_phase()


func _enter_battle_phase() -> void:
	_phase = GamePhase.BATTLE
	_hud.set_phase("Battle")
	_shop.visible = false
	_bench.visible = false
	_hud.set_battle_button_enabled(false)
	_hud.update_timer(0)  # Hide timer

	print("=== BATTLE PHASE — Round %d ===" % _round)
	print("  Player units: %d | Enemy units: %d" % [_board_units.size(), _battle_board._enemy_units.size()])

	# Start the auto-battle
	_battle_board.start_battle(_board_units.duplicate(), _battle_board._enemy_units.duplicate())


func _on_battle_ended(player_won: bool, units_remaining: int) -> void:
	_last_battle_won = player_won
	_last_battle_units_remaining = units_remaining
	_enter_reward_phase()


func _enter_reward_phase() -> void:
	_phase = GamePhase.REWARD
	_hud.set_phase("Reward")

	if _last_battle_won:
		var bonus := _round
		_gold += GOLD_PER_ROUND + bonus
		print("Round %d WON! +%d gold" % [_round, GOLD_PER_ROUND + bonus])
	else:
		var damage := _last_battle_units_remaining * 5 + _round
		_player_hp -= damage
		_gold += GOLD_PER_ROUND  # Still get base gold
		print("Round %d LOST! -%d HP" % [_round, damage])

	_round += 1
	_update_ui()

	# Check game over
	if _player_hp <= 0:
		_game_over()
		return

	# Clean up the board
	_cleanup_after_battle()

	# Brief pause then start next round
	await get_tree().create_timer(1.5).timeout
	_enter_prep_phase()


func _game_over() -> void:
	_phase = GamePhase.GAME_OVER
	_hud.set_phase("GAME OVER")
	_shop.visible = false
	_bench.visible = false
	_hud.set_battle_button_enabled(false)
	_hud.update_timer(0)

	var label := Label.new()
	label.text = "GAME OVER\nYou survived %d rounds!\nRestart the game to try again." % (_round - 1)
	label.add_theme_font_size_override("font_size", 28)
	label.add_theme_color_override("font_color", Color(0.9, 0.2, 0.2))
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.anchors_preset = Control.PRESET_CENTER
	label.position = Vector2(400, 250)
	$UILayer.add_child(label)


func _cleanup_after_battle() -> void:
	_battle_board.clear_board()
	_board_units.clear()


# ═══════════════════════════════════════════════════════════
#  UNIT PURCHASE & PLACEMENT
# ═══════════════════════════════════════════════════════════

func _on_unit_purchased(unit_data: Dictionary) -> void:
	var cost: int = unit_data.get("cost", 0)
	if _gold < cost:
		print("Not enough gold!")
		return
	if _bench.is_full() and _board_units.size() >= MAX_BOARD_UNITS:
		print("No room! Bench and board are full.")
		return

	_gold -= cost
	_update_ui()
	_bench.add_unit(unit_data)


func _on_bench_unit_selected(unit_data: Dictionary, bench_index: int) -> void:
	if _phase != GamePhase.PREP:
		return
	if _board_units.size() >= MAX_BOARD_UNITS:
		print("Board is full! Max %d units." % MAX_BOARD_UNITS)
		return

	_placing_unit_data = unit_data
	_selected_bench_index = bench_index
	print("Click on a blue tile (rows 3-4) to place %s" % unit_data.get("name", "unit"))


func _try_place_unit(click_pos: Vector2) -> void:
	var board_pos: Vector2 = click_pos - _battle_board.global_position
	var grid_pos: Vector2i = _battle_board.world_to_grid(board_pos)

	# Only allow placement in player zone (rows 3-4)
	if grid_pos.y < 3 or grid_pos.y > 4:
		print("Can only place in your zone (bottom 2 rows)")
		return

	if not _battle_board.is_valid_cell(grid_pos) or _battle_board.is_cell_occupied(grid_pos):
		print("Cell is occupied or invalid")
		return

	# Create the unit node
	var unit_scene := preload("res://scenes/unit.tscn")
	var unit_node: Node2D = unit_scene.instantiate()
	_battle_board.add_child(unit_node)
	unit_node.call("setup_from_data", _placing_unit_data, true)

	if _battle_board.place_unit(unit_node, grid_pos):
		_board_units.append(unit_node)
		_bench.remove_unit(_selected_bench_index)
		print("Placed %s at %s" % [_placing_unit_data.get("name", ""), grid_pos])
		_hud.set_battle_button_enabled(true)
	else:
		unit_node.queue_free()

	# Exit placement mode
	_placing_unit_data = {}
	_selected_bench_index = -1


# ═══════════════════════════════════════════════════════════
#  CINEMATIC EFFECTS
# ═══════════════════════════════════════════════════════════

func juice_camera_punch(intensity: float = 1.0) -> void:
	var cam = get_node_or_null("MainCamera")
	if not cam:
		return

	var tween = create_tween()
	tween.tween_property(cam, "zoom", Vector2(1.05, 1.05), 0.1).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_SINE)
	tween.tween_property(cam, "zoom", Vector2(1.0, 1.0), 0.3).set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)

	var shake_tween = create_tween()
	shake_tween.set_loops(4)
	shake_tween.tween_property(cam, "position", Vector2(640, 360) + Vector2(randf_range(-10, 10) * intensity, randf_range(-10, 10) * intensity), 0.05)
	shake_tween.tween_property(cam, "position", Vector2(640, 360), 0.05)
