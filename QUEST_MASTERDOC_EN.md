# Quest Masterdoc (English, Full Quest Dialogue Reference)

Quick reference for quest order, objectives, and full quest-relevant dialogue text.

## Main Quest Order

1. `first_catch` (A Fisher's First Catch)
2. `heed_the_warning` (Heed the Warning) and `anti_death_measures` (Anti-death Measures)
3. `village_weirdo` (The Village Weirdo)
4. `bowl_that_shines` (The Bowl that Shines)
5. `wizards_scar` (The Wizard's Scar)

## Side Quests

- `merchant_side_brew` (Merchant's Brew)
- `wares_galore` (Wares Galore)

---

## `first_catch` - A Fisher's First Catch

**Objectives**
1. Catch a fish
2. Talk to Fisherman

**Start / Fisherman dialogue (first encounter)**
- NPC: "Huh. The tide dragged in something new."
- Player: "Wh— where am I?"
- NPC: "Anchor Hollow. Little island, big ocean."
- Player: "Anchor Hollow? I've never heard of this place."
- NPC: "Most haven't. Storm brought you in?"
- Player: "I was sailing from home. My dad is sick — really sick. I left to find a cure for him."
- NPC: "A cure. Hm. Can't help you there, kid. I know fish. That's about it."
- Player prompt: "What should I ask?"
  - Option: "What is this island?"
    - NPC: "Small. Quiet. Handful of us live here. We fish, we eat, we mind our business."
    - NPC: "There's a town further in. Guard watches the bridge, merchant sells things, couple others."
    - NPC: "They'd know more about the world than I do. I just know the water."
  - Option: "Has anyone come here looking for something like that?"
    - NPC: "People wash up looking for all kinds of things. Most of them find fish."
    - NPC: "But the island's got old things in it. Older than the docks. Older than me."
    - NPC: "Talk to the folks in town. Someone might point you somewhere."
- (Both options converge:)
- NPC: "But first — you look half-drowned and fully starved. Can't look for anything on an empty stomach."
- NPC: "Fishing's how we survive out here. I'll set you up."
- Player prompt: "What do I need to do?"
  - Option: "Alright, hand me a rod."
    - If player already has rod:
      - NPC: "You've already got one. Good. Find water, cast the line, and reel when it tugs."
    - If player does not have rod:
      - NPC: "Here. She's rickety, but she catches. Don't drop her in the water."
      - NPC: "Equip it, walk to the water's edge, and cast. When the line pulls — reel."
  - Option: "Wait — how does fishing even work?"
    - NPC: "Equip the rod. Stand near water. Cast the line."
    - NPC: "When you feel a tug, that's a bite. Reel it in before it swims off."
    - (If player does not have rod:)
      - NPC: "Oh — you'll need one of these."
- NPC: "Land one and come back to me. Then we'll talk more."

**Objective 1 (`objectiveIndex: 0`) reminder dialogue**
- NPC: "Still dry? The water's right there, kid."
- NPC: "Cast the line. Reel when it bites. Bring me what you catch."

**Objective 2 (`objectiveIndex: 1`) return dialogue**
- NPC: "Ha! Look at that. Your first catch."
- Player: "That was... actually kind of fun?"
- NPC: "Don't let the fish hear you say that."
- NPC: "You did good, kid. Natural grip. Most newcomers yank too hard and snap the line."
- Player: "So there's more to it than just reeling?"
- NPC: "There's always more. Better rods, deeper water, rarer fish. The basics get you fed. Everything past that gets you rich."
- NPC: "And then there's whatever's underneath."
- Player: "Underneath?"
- NPC: "Something old. Past where the lines reach. I've fished these docks longer than I care to count, and I've never touched the edge of it."
- NPC: "Not my business, though. I catch what bites."
- NPC: "Head into town, kid. Meet the Guard, the Merchant. They'll teach you things I can't."
- NPC: "And if you ever need the water — I'll be here. I'm always here."

---

## `heed_the_warning` - Heed the Warning

**Objectives**
1. Stay in `Danger` for 60s
2. Talk to Guard

**Start / Guard dialogue**
- NPC: "WOAH! Where do you think you're going??"
- Player prompt: "How should I answer?"
  - Option: "Uhhh... I'm just exploring I guess?"
    - NPC: "Well, what do you think is over there? A fancy hotel? Look kid, you aren't ready for what's across this bridge"
    - Player: "Yes I am."
    - NPC: "NO YOU AREN'T!"
    - Player: "Yes I am."
    - NPC: "Okay fine. If you're really so tough, cross this bridge, and stay a while. Let's say... 60 seconds. Sound good?"
    - Player: "Sure!"
    - NPC: "HA! Alright, good luck!"

**Objective 1 (`objectiveIndex: 0`) reminder dialogue**
- NPC: "Cross this bridge, survive 60 seconds in the danger zone, then report back to me."

**Objective 2 (`objectiveIndex: 1`) return dialogue**
- Player: "I'm back!"
- NPC: "WHAT?? How did you survive that???"
- Player: "I kinda just ran around..."
- NPC: "Well, color me impressed. Not many in our town could survive out there..."
- NPC: "Tell you what, If you gear up right, and show me that you're ready, I'll help you learn how to fight these evil beasts."
- Player prompt: "How should I respond?"
  - Option: "Yay!"
    - NPC: "Don't worry, you'll know when you are ready. Until then, good luck."
  - Option: "Hooray!"
    - NPC: "Don't worry, you'll know when you are ready. Until then, good luck."
  - Option: "Cool."
    - NPC: "Don't worry, you'll know when you are ready. Until then, good luck."

---

## `anti_death_measures` - Anti-death Measures

**Objectives**
1. Harvest `yekbush`
2. Talk to Merchant

**Start / Merchant dialogue**
- NPC: "Looking to buy something?"
- Player prompt: "What do I even say?"
  - Option: "Uhhh... I guess?"
    - NPC: "Then let's start with money. You got any?"
    - Player: "No... not a single coin."
    - NPC: "How are you even surviving in Anchor Hollow?"
    - Player: "I'm new here. Still figuring things out."
    - NPC: "Alright, I'll help. Find a nearby Yekbush and grab some yekberries for a barely nourishing meal."
    - NPC: "Bring them back to me when you've harvested one."

**Objective 1 (`objectiveIndex: 0`) reminder dialogue**
- NPC: "Find a nearby Yekbush and gather some yekberries. Barely nourishing, but enough to keep you alive."
- NPC: "Come back once you've picked a bush and we'll call you battle-ready."

**Objective 2 (`objectiveIndex: 1`) return dialogue**
- NPC: "Good haul. Those yekberries keep fighters standing."
- Player: "So this is just... survival food?"
- NPC: "For now. Come back when you want the advanced method, and I'll show you how to refine food."
- NPC: "Keep a few slotted and use them before panic takes over. Then we'll upgrade your menu."

---

## `merchant_side_brew` - Merchant's Brew (Side Quest)

**Objectives**
1. Talk to Merchant
2. Refine `yekberries` -> `yekjuiceliquid`
3. Talk to Merchant
4. Bottle `yekjuiceliquid` + `jar` -> `yekjuice`
5. Talk to Merchant

**Start (`merchant_side_brew` intro)**
- NPC: "Back for lesson two? Good. Raw food keeps you alive, refined food wins fights."
- Player: "So spending time on prep actually matters?"
- NPC: "Always. First trick: pressure extraction."
- NPC: "Drop your berries, stomp them into liquid, then report back."

**Objective 2 (`objectiveIndex: 1`)**
- NPC: "Drop your yekberries on the ground and walk over them a few times."
- NPC: "No dainty steps. Mash them like they insulted your knife."

**Objective 3 (`objectiveIndex: 2`)**
- NPC: "Perfect stomp-work. You wrung those berries into liquid."
- NPC: "Hands can't hold a puddle, so use a jar. I'll spot you one for free."
- NPC: "Next time, you pay. Glass doesn't grow on trees."

**Objective 4 (`objectiveIndex: 3`)**
- NPC: "You made juice, now bottle it. Click the puddle and confirm the pour."
- NPC: "One jar in, one serving of Yek Juice out. Chemistry with consequences."

**Objective 5 (`objectiveIndex: 4`) complete**
- NPC: "Now THAT is proper fuel. Smooth, sharp, and it actually keeps a blade-cat standing."
- Player: "That healed way better than the raw berries."
- NPC: "Exactly. Skill in the kitchen is skill in combat, just with fewer screams."
- NPC: "Come back later and I'll teach you deadlier recipes. Anchor Hollow feeds those who experiment."

---

## `village_weirdo` - The Village Weirdo

**Objectives**
1. Collect 5 `yekberries`
2. Talk to Traveller

**Start / Traveller dialogue**
- NPC: "Traveler's request: could you bring me 5 yekberries?"
- Player: "Five? That's oddly specific."
- NPC: "Specific goals build character. Please and thank you."

**Objective 1 (`objectiveIndex: 0`) reminder dialogue**
- NPC: "I still need 5 yekberries. Bring all five and I'll make it worth your time."

**Objective 2 (`objectiveIndex: 1`) return dialogue**
- NPC: "You actually came back with five yekberries. You're incredibly kind."
- NPC: "Confession: this was a social experiment. I wanted to see if Anchor Hollow still had generous people."
- Player: "Bro is NOT MrBeast."
- NPC: "Fair. My budget is... less theatrical."
- NPC: "I can spare one silver coin. It's not much, but it'll be useful."
- Player: "I've never had a coin before..."
- NPC: "You've never had a coin? What, do you live under a rock?"
- NPC: "A silver coin is worth 100 bronze coins."
- NPC: "And 100 silver coins make one gold coin."
- NPC: "One silver might not look like much, but used properly, it can get you what you need."

---

## `wares_galore` - Wares Galore (Side Quest)

**Objectives**
1. Talk to Merchant

**Merchant dialogue (`objectiveIndex: 0`)**
- NPC: "I heard through the grapevine that you have some money now... are the stories true?"
- Player: "I guess..."
- NPC: "Marvelous! A customer with coin is my favorite kind of miracle."
- NPC: "Come see my wares any time. Soon I'll open the full stall for you."

**Post-completion merchant line**
- NPC: "You've got the look of a customer now. My wares are ready when you are."

---

## `bowl_that_shines` - The Bowl that Shines

**Objectives**
1. Talk to Sea Master
2. Talk to Traveller
3. Wait for night window (23:00-04:00)
4. Fish near `KeyLocation`
5. Talk to Sea Master
6. Open `glimmeringchest`
7. Talk to Sea Master

**Quest start / Wise Man dialogue**
- NPC: "You look tired."
- Player: "How do you know?"
- NPC: "I've always been gifted."
- Player: "How gifted are we talking?"
- NPC: "Ha! You're funny."
- NPC: "I can share a secret. One that lifts weight from your shoulders and opens a whole new world."
- Player prompt: "Do I want to hear it?"
  - Option: "Yes."
    - NPC: "Good. Speak to the Sea Master."
    - NPC: "Tell him the collector of glass sent you."
    - NPC: "Do not improvise."

**Objective 1 (`objectiveIndex: 0`) Wise Man reminder**
- NPC: "Find the Sea Master and say the collector of glass sent you."

**Objective 1 (`objectiveIndex: 0`) Sea Master passphrase gate**
- NPC: "If you have business with me, say it plainly."
- Player option: "The glass collector sent me."
  - NPC: "What?? Is that supposed to mean something to me? SCRAM KID!"
- Player option: "The collector of glass sent me."
  - NPC: "The Wise Man would only hand out that code if he trusted you."
  - Player prompt: "How should I answer?"
    - Option: "... I kinda met him 30 seconds ago"
      - NPC: "Thirty seconds? Hmph. Then your timing is suspiciously perfect."
      - Shared continuation:
        - NPC: "Listen closely. I used to be an archaeologist in the desert, always setting out on expeditions."
        - NPC: "One day, I found a chest unlike anything I'd seen."
        - NPC: "My top-secret sources said the key to that chest, the Glimmering Chest, was likely lost somewhere in the desert."
        - NPC: "So I brought the chest to Anchor Hollow and stayed. I set my sights on the sea and learned every current I could."
        - NPC: "In trying to find that key, I became the Sea Master."
        - NPC: "And now I grant you the privilege of helping me search for it."
        - Player: "What info have you collected so far?"
        - NPC: "I know it's somewhere around the docks."
        - NPC: "You might ask around Anchor Hollow for new rumors... though avoid the Traveller. She's suspicious. Weird."
        - NPC: "Good luck."
    - Option: "Yes, we've been pals for life!"
      - NPC: "Pals for life, huh? You don't look old enough for that claim."
      - Shared continuation:
        - NPC: "Listen closely. I used to be an archaeologist in the desert, always setting out on expeditions."
        - NPC: "One day, I found a chest unlike anything I'd seen."
        - NPC: "My top-secret sources said the key to that chest, the Glimmering Chest, was likely lost somewhere in the desert."
        - NPC: "So I brought the chest to Anchor Hollow and stayed. I set my sights on the sea and learned every current I could."
        - NPC: "In trying to find that key, I became the Sea Master."
        - NPC: "And now I grant you the privilege of helping me search for it."
        - Player: "What info have you collected so far?"
        - NPC: "I know it's somewhere around the docks."
        - NPC: "You might ask around Anchor Hollow for new rumors... though avoid the Traveller. She's suspicious. Weird."
        - NPC: "Good luck."
- Player option: "The shard keeper sent me."
  - NPC: "What?? Is that supposed to mean something to me? SCRAM KID!"

**Objective 2 (`objectiveIndex: 1`) Traveller clue dialogue**
- NPC: "What's up?"
- Player: "Have you seen a key?"
- NPC: "Nope. But I heard this: when the sky is dark and the stars glimmer, the moon reveals treasure reflections in the water."
- NPC: "If you're key hunting, check the docks at night."

**Objective 5 (`objectiveIndex: 4`) Sea Master key-return dialogue**
- NPC: "By the rolling tide... that's the Glimmering Key."
- NPC: "I am genuinely impressed. You found what I could not."
- NPC: "And here's the twist: keep the treasure for yourself. I've taken enough from the sea in my lifetime."
- Player: "Thank you... seriously."
- NPC: "The chest is waiting. Go open it."

**Objective 7 (`objectiveIndex: 6`) Sea Master follow-up**
- NPC: "So, what did the chest reveal? Hah, don't tell me yet."
- NPC: "We'll speak again soon. For now, let this be your beginning."

---

## `wizards_scar` - The Wizard's Scar

**Depends on:** `bowl_that_shines`

**Description:** The Wise Man senses the Glimmerbowl's awakening and sends you to a reclusive Wizard. Convince the Wizard you're worth his time, learn about scars, and forge your first one.

**Objectives:**
0. Talk to Wizard (`talk-to-npc`, wizard)
1. Walk away (`leave-npc-radius`, Wizard, 10m)
2. Talk to Wizard (`talk-to-npc`, wizard, hideGuidance) — auto-resume forced dialogue
3. Collect 10 Jars (`inventory-count`, jar, 10)
4. Talk to Wizard (`talk-to-npc`, wizard)

### Start: Wise Man dialogue

**Wise Man sends MC to Wizard (triggers quest start)**
- NPC (Wise Man): "Hold still. Something is... different about you. There's a hum. A vibration. You've awakened the Glimmerbowl, haven't you?"
- Player: "The Glimmerbowl? I mean, I found it, but I don't really understand what it does."
- NPC: "The Glimmerbowl is no ordinary tool. Long ago, creatures of the deep sea forged it from moonstone and tide-glass. They believed that every fish carried a fragment of a soul—and this bowl was the key to channeling those fragments."
- NPC: "Only those whose spirit is in tune with the sea can command it. And it seems... you are one of the very few."
- Player: "Fragments of a soul? That sounds... intense."
- NPC: "But raw power without understanding is a storm without a harbor. You need guidance. There is someone who can help—a Wizard who lives on the outskirts of town."
- NPC: "Find the Wizard. Tell him these exact words: 'The bowl scavenger sent me.' He'll know what it means."
- Player: "Another password? Seriously? Does anyone on this island just talk to each other normally?"
- NPC: "His bark is worse than his bite. Probably. Go now, and don't forget the phrase."
- Player: "Fine. 'The bowl scavenger sent me.' Got it. I think."

**Wise Man reminder (if quest active, objective 0)**
- NPC: "The Wizard is waiting. Tell him: 'The bowl scavenger sent me.' And try not to annoy him. Too much."

### Objective 0: Talk to Wizard

**Wizard intro (rude, dismissive)**
- NPC (Wizard): "What do you want? I don't have time for small talk. Or big talk. Or any talk."
- Player: "Uh... hello? The Wise Man sent me. I have a password."
- NPC: "Oh, a passphrase. How quaint. How delightfully pedestrian. You think a string of words entitles you to my time?"
- Player choice:
  - **"The bowl scavenger sent me."**
    - NPC: "'The bowl scavenger.' Wonderful. So the old man is still sending strays to my door. That doesn't change anything."
    - Player: "Wait, you know who sent me?"
    - NPC: "But I was told you could help me understand—"
  - **"I have a Glimmerbowl!"**
    - NPC: "A Glimmerbowl. Fascinating. Everyone and their grandmother claims to have one these days. Mostly it's a soup bowl with glitter."
    - Player: "But it's really a Glimmerbowl! Look!"
    - NPC: "This one is real! The Wise Man said—"

(Both paths result in the Wizard dismissing the player. Quest advances to objective 1: "Walk away.")

### Objective 1: Walk away (leave-npc-radius, 10m)

Player walks at least 10 meters away from the Wizard POI.

**Client-side guide triggers:**
- Guide overlay: "Click on the world to activate your Glimmerbowl."
- Player clicks anywhere on the world (triggering `triggerWorldGlimmerbowl()` via normal input).
- Guide clears.
- 2-second delay.

### Objective 2: Auto-resume forced dialogue

**Wizard is stunned by the MC's raw Glimmerbowl control:**
- NPC: "Wait. WAIT. Get back here!"
- Player: "What?! What just happened?!"
- NPC: "Did you just... did the bowl actually respond to you? Out here? Without a scar, without a binding, without anything?"
- NPC: "That's... that shouldn't be possible. The Glimmerbowl doesn't just activate for anyone. It chooses. And it chose YOU."
- NPC: "I've spent decades studying these artifacts and I've never seen someone command one raw like that. Not once."
- NPC: "Sit down. No, stand up. No—just stay where you are. We need to talk about scars."
- NPC: "A scar is a magical sigil. When applied to a fish, it awakens something dormant inside the creature. The fish becomes a figment of your soul—your thoughts, your will, fused into its being."
- Player: "A figment of my soul? That's... kind of beautiful. And kind of terrifying."
- NPC: "From that point on, that fish doesn't just swim. It fights. For you. Through the Glimmerbowl. Your intent becomes its action. Your resolve becomes its strength."
- NPC: "I can make you one. A Nightfire Scar. It's entry-level as far as scars go, but for someone at your stage it'll be more than enough."
- NPC: "But I need materials. Ten jars. Empty ones. The binding ritual requires glass vessels to contain the sigil while it forms. Here—take these coins. Two silver should cover it."
- Player: "Ten jars. Two silver. Got it. I'll be back."
- NPC: "Now go. Get the jars. Don't dawdle. And don't break them."

(After dialogue completes, `sendNpcInteract('wizard')` advances objective 2 → 3. Server grants 200 money.)

### Objective 3: Collect 10 Jars

**Wizard jar reminder (if talked to during collection)**
- NPC: "Ten jars. Empty. Glass. Not broken. Is any of this getting through?"

### Objective 4: Return to Wizard

**Wizard jar return dialogue**
- NPC: "You got them. All ten. And none of them are cracked. I'm almost impressed."
- Player: "So what happens now?"
- Player: "Here they are! All ten, safe and sound."
- NPC: "Good. Now don't move. Don't talk. Don't even think too loudly. This is delicate work."

(Dialogue ends. Quest completes. Screen fades to black for 3 seconds.)

**Scar completion forced dialogue (after fade-in)**
- NPC: "It's done. The Nightfire Scar. Take it. Handle it carefully—it's more fragile than it looks, and more powerful than you deserve."
- Player: "Thank you. Really."
- NPC: "When you're ready, apply it to a fish. You'll know what to do. Probably. Maybe. Just don't waste it."

(Player receives `nightfire_scar` via `dialogue:give-item`.)
