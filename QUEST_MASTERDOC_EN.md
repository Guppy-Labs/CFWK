# Quest Masterdoc (English, Full Quest Dialogue Reference)

Quick reference for quest order, objectives, and full quest-relevant dialogue text.

## Main Quest Order

1. `first_catch` (A Fisher's First Catch)
2. `heed_the_warning` (Heed the Warning) and `anti_death_measures` (Anti-death Measures)
3. `village_weirdo` (The Village Weirdo)
4. `bowl_that_shines` (The Bowl that Shines)

## Side Quests

- `merchant_side_brew` (Merchant's Brew)
- `wares_galore` (Wares Galore)

---

## `first_catch` - A Fisher's First Catch

**Objectives**
1. Catch a fish
2. Talk to Fisherman

**Start / Fisherman dialogue**
- NPC: "Welcome to Anchor Hollow! Name's the Fisherman."
- Player prompt: "What should I ask?"
  - Option: "Can I get a fishing rod?"
    - If player already has rod:
      - NPC: "You've already got your rod. Equip it, then head to the water and cast your line."
    - If player does not have rod:
      - NPC: "Aye, here you go - your first rod."
      - NPC: "Equip your rod, find a good stretch of water, then cast and reel in your catch."
  - Option: "How do I fish?"
    - NPC: "Equip your rod, find water, cast your line, and reel when you feel a bite."
    - NPC: "Once you've landed one, come back to me. You'll know the basics... but there's a big secret I still don't know."

**Objective 2 (`objectiveIndex: 1`) return dialogue**
- NPC: "Ha! You did it. You've got the basics of fishing down now."
- NPC: "But there's a big secret beneath these waters... and I still don't know what it is."
- NPC: "You should venture further onto the island to learn how things work around here."

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
