# 画像生成プロンプト（Codex用）

共通スタイル: semi-flat cyberpunk illustration with soft volumetric glow and depth (not overly flat), deep navy background (#0a1330), electric cyan (#2ee6ff) and yellow (#ffd83a) accent lighting, rounded friendly shapes, subtle film grain, no text, no logos.

## keyvisual.png（表紙キービジュアル / 16:9 / 1920x1080）
Wide cinematic key visual. A young cyborg hero with a glowing cyan chest core and a yellow-lit absorber arm stretches an arc of electricity out toward a hovering security robot, pulling a stream of yellow lightning into his body. Dark powered-down futuristic city skyline behind, only a few cyan windows lit. Dynamic low-angle composition, hero on the left third, empty space on the right for title text. Deep navy background, cyan and yellow electric colors, 16:9, 1920x1080.

## hero.png（主人公サイボーグ / 縦長 3:4 / 1200x1600）
Full-body character design of a cyborg protagonist, standing in a heroic three-quarter pose. Rounded friendly armored body, glowing cyan energy lines, a battery-like chest core, a jetpack on the back, a scouter visor on one eye, a mechanical absorber arm on the right arm and a compact electric pistol in the left hand. Clean plain dark navy background with soft rim light, cyan and yellow accents, not overly flat, 3:4 portrait, 1200x1600.

## city.png（世界観: 停電した未来都市 / 16:9 / 1920x1080）
A futuristic megacity during a total blackout. Tall skyscrapers and elevated highways, AI robots and delivery drones frozen and dark in the streets, only emergency cyan lights and one distant yellow glowing power plant tower on the horizon. Moody night atmosphere with fog and soft glow, a tiny cyborg silhouette standing in the foreground. Deep navy dominant, cyan and yellow electric colors, 16:9, 1920x1080.

## villain.png（黒幕の研究者 / 縦長 3:4 / 1200x1600）
Character portrait of a mad scientist villain who monopolizes the world's electricity. Middle-aged, sharp eyes, white lab coat with glowing yellow circuit lines, a floating holographic cyan globe of power grid behind him, cables plugged into his back like a throne of wires. Confident menacing smile, dramatic rim light, dark navy background, cyan and yellow electric colors, not overly flat, 3:4 portrait, 1200x1600.

---

## ゲーム概要・詳細・セールスポイント用（2026-10-29 追加）

全プロンプトの先頭に「共通スタイル」、主人公が出る画像には「主人公の説明」も付けてください。
できた画像は `docs/kikakusho/img/` に同じファイル名（PNG）で置けば、スライドに自動で入ります。

**共通スタイル**
Anime cel-shaded video game art, clean bold outlines, third-person action shooter look, futuristic city during a total blackout, dark navy night lighting with glowing cyan and yellow electricity, cinematic, high detail, no text, no UI, no watermark, 16:9.

**主人公の説明**
A huge muscular male cyborg hero with dark brown skin, short spiky black mohawk hair and a full black beard, white headphone-like devices on both ears with a glowing ring. Chunky angular white armor plates on chest, giant shoulders, forearms, thighs and shins over a black bodysuit with visible abs. Mustard-yellow accents: inverted triangle on the chest, small panels on the shoulders, wrist bands, boot soles. His LEFT upper arm is a thick silver coil spring connecting the shoulder armor to a yellow wrist band and white armored forearm with a black fist. Right arm is white armor with a black glove holding a chunky white-and-black sci-fi pistol with yellow accents and a cyan glowing muzzle.

**敵ロボットの説明**
Angular boxy enemy robots (floating drones and short-legged walkers), dark gunmetal armor, a glowing electric core in the chest.

| ファイル名 | 内容（共通スタイル＋主人公の説明＋以下） |
|---|---|
| ov_absorb.png | Over-the-shoulder view. The hero shoots his spring arm forward, the coil stretches long and his fist clamps onto an enemy robot; bright cyan electricity flows from the robot back through the spring into the hero. The robot's core is dimming. |
| ov_attack.png | Over-the-shoulder view. The hero aims the pistol with both arms fully extended at shoulder height, left side of his body forward, firing a bright cyan electric bolt that hits an enemy robot. |
| ov_transmit.png | The hero's stretched spring arm is attached to an enemy robot and pumps intense orange-white electricity INTO it; the robot is overheating, glowing red-orange with sparks bursting from its seams. |
| d_absorb.png | Close-up action shot of the spring arm stretched to a floating drone robot, draining cyan energy streams from its core; a glowing energy gauge feeling, sparks around the fist. |
| d_weakpoint.png | Over-the-shoulder aiming shot. A large walker robot turned away, a glowing yellow weak-point core on its back; the hero fires a charged electric shot right into it, impact flash. |
| d_transmit.png | Side view. The hero braces his legs, spring arm extended and locked onto a heavy robot, sending a thick orange lightning current into it; the hero's own body glow is dimming to show he is spending power. |
| d_short.png | A robot short-circuiting and exploding in a huge orange-and-cyan electric blast, shrapnel and lightning arcs, nearby small robots caught in the blast; the hero in the foreground shielding his face. |
| t_arm.png | The hero plugs his spring-arm fist into a dead power socket on a dark sci-fi door panel, sending cyan electricity; the panel lights up. |
| t_grapple.png | Low-angle shot. The hero's spring arm stretches far upward and grabs the edge of a high ledge on a dark skyscraper; he is being pulled up through the air. |
| t_jetpack.png | The hero flying over a dark blackout city with small cyan jet flames from a backpack, scanning the streets below. |
| t_gun.png | Product-style close-up of the hero's chunky white-and-black sci-fi pistol with yellow accents, charging with a cyan electric sphere at the muzzle, held in his black glove. |
| t_shield.png | The hero raises his forearm and projects a translucent hexagonal cyan electric energy shield that blocks red enemy laser bolts. |
| sp_puzzle.png | Wide shot of a dark maintenance hall. The hero sends electricity through his spring arm into a large generator; glowing cyan cables light up in sequence across the floor and walls, and a massive sealed gate starts to open, light spilling out. |

## 作り直し用（2026-10-29）
共通スタイルの「16:9」は、hero.png と t_grapple.png では指定のアスペクト比に置き換える。キャラクターシート画像を参考として一緒に渡す。

| ファイル名 | 内容（共通スタイル＋主人公の説明＋以下） |
|---|---|
| keyvisual.png（16:9） | Epic key visual. The hero stands on the right half of the frame on a rooftop edge above a pitch-black blackout city, body turned three-quarters toward the viewer. His left spring arm is stretched far out, the fist clamped onto a large floating sphere robot, draining bright cyan lightning into himself; his right hand holds the pistol low. Behind him the dark skyline, one distant tower glowing ominously yellow. Leave the left 45% of the image dark and calm as empty space for a title. |
| hero.png（3:4 縦長） | Full-body character portrait of the hero, front three-quarter view, standing confidently with the pistol in his right hand pointed down and his left spring arm slightly flexed with faint cyan sparks around the coil. Simple dark navy gradient background with subtle cyan electric lines. Entire body visible from head to boots. |
| t_grapple.png（3:4 縦長） | Vertical low-angle shot. The hero's left spring arm is stretched extremely long straight upward, the coil clearly visible, and his fist grips the edge of a high ledge on a dark skyscraper; he is being pulled up through the air, legs dangling, city lights far below. |
