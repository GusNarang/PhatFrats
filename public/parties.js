// Demo parties (fictional). Shared by the page and the server so both agree on what exists.
(function () {
  const PARTIES = [
    {id:"p1", ch:15, title:"Totally Rad '80s Prom", day:"thu", time:"9:30 PM", vibe:"theme", blurb:"Teased hair, neon windbreakers and a slow-dance set at midnight. Prom king and queen get crowned on the stairs.", dress:"Thrift-store '80s", music:"'80s synth-pop into throwbacks", cap:180, going:131},
    {id:"p2", ch:17, title:"TDX Karaoke Cage Match", day:"thu", time:"9:00 PM", vibe:"chill", blurb:"Bracket-style karaoke. Bring a duet partner and your most unhinged song pick. Winner's name goes on the house trophy.", dress:"Whatever you sing best in", music:"You, live", cap:120, going:74},
    {id:"p3", ch:30, title:"Leftover Costume Bash", day:"thu", time:"10:00 PM", vibe:"theme", blurb:"Halloween was last weekend, but the costumes aren't done. Wear it one more time. Best repeat costume wins.", dress:"Your Halloween costume, round two", music:"Top 40 & mashups", cap:200, going:188},
    {id:"p4", ch:1, title:"Neon Jungle", day:"fri", time:"10:00 PM", vibe:"neon", blurb:"Blacklights in every room, vines on the ceiling and a light-up dance floor in the basement.", dress:"Anything that glows", music:"House & EDM, guest DJ", cap:250, going:241},
    {id:"p5", ch:19, title:"FIJI Island Luau", day:"fri", time:"9:30 PM", vibe:"theme", blurb:"Tiki torches (LED, relax), a sand pit in the yard and a limbo contest that has gotten competitive.", dress:"Hawaiian shirts & leis", music:"Reggae, tropical house", cap:220, going:165},
    {id:"p6", ch:12, title:"Country Club Mixer", day:"fri", time:"8:30 PM", vibe:"formal", blurb:"Putting green in the living room, croquet on the lawn, and very serious sweater vests.", dress:"Polos, tennis whites, pearls", music:"Yacht rock", cap:160, going:98},
    {id:"p7", ch:4, title:"AGR Barn Dance", day:"fri", time:"8:00 PM", vibe:"chill", blurb:"Hay bales, string lights and a caller teaching line dances for the first hour. Ag school pride.", dress:"Flannel & boots", music:"Country, then everything", cap:200, going:119},
    {id:"p8", ch:26, title:"Beaver Ave Block Party", day:"sat", time:"1:00 PM", vibe:"day", blurb:"Day party on the porch with lawn games, a cornhole bracket and the game on a projector screen.", dress:"Blue & white", music:"Hip-hop & pop", cap:300, going:276},
    {id:"p9", ch:31, title:"White Out Warm-Up", day:"sat", time:"4:00 PM", vibe:"day", blurb:"Everything white, head to toe. Face paint station in the front room.", dress:"All white", music:"Stadium anthems", cap:220, going:209},
    {id:"p10", ch:20, title:"Après-Ski Lodge", day:"sat", time:"10:00 PM", vibe:"theme", blurb:"The house becomes a ski chalet: fake snow, a fireplace on every TV and a hot cocoa bar.", dress:"Ski gear, puffers, goggles", music:"Euro house", cap:200, going:152},
    {id:"p11", ch:28, title:"Casino Royale", day:"sat", time:"9:00 PM", vibe:"formal", blurb:"Blackjack and roulette tables with play money. High rollers win a spot at the spring formal.", dress:"Black tie optional", music:"Jazz lounge, then the DJ", cap:180, going:143},
    {id:"p12", ch:21, title:"Basement Rave", day:"sat", time:"11:00 PM", vibe:"neon", blurb:"Fog machine, lasers and two student DJs going back to back until close.", dress:"Black & neon", music:"Techno & drum and bass", cap:150, going:149},
    {id:"p13", ch:25, title:"Pancakes for a Purpose", day:"sun", time:"10:00 AM", vibe:"charity", blurb:"All-you-can-eat pancakes. Every plate supports The Ability Experience, Pi Kappa Phi's national philanthropy.", dress:"Pajamas encouraged", music:"Sunday morning acoustic", cap:250, going:86},
    {id:"p14", ch:6, title:"Sunday Sauce Night", day:"sun", time:"6:00 PM", vibe:"chill", blurb:"Homemade pasta dinner, family style. Bring a friend and an appetite.", dress:"Comfy", music:"Sinatra on vinyl", cap:90, going:51}
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = PARTIES;
  else globalThis.PF_PARTIES = PARTIES;
})();
