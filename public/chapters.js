// IFC chapters from pennstateifc.org/chapters. Shared by the page (directory and map) and the server (PhatBot).
(function () {
  const CHAPTERS = [
    {id:1, name:"Alpha Chi Rho", gl:"ΑΧΡ", addr:"425 Locust Lane", street:"Locust Lane", ig:"axp.psu"},
    {id:2, name:"Alpha Delta Phi", gl:"ΑΔΦ", addr:"225 E Foster Ave", street:"Foster Ave", ig:"psualphadelt"},
    {id:3, name:"Alpha Epsilon Pi", gl:"ΑΕΠ", addr:"240 E Prospect Ave", street:"Prospect Ave", ig:"aepi_pennstate"},
    {id:4, name:"Alpha Gamma Rho", gl:"ΑΓΡ", addr:"322 Fraternity Row", street:"Fraternity Row", ig:"agrpsu"},
    {id:5, name:"Alpha Kappa Lambda", gl:"ΑΚΛ", addr:"339 Fraternity Row", street:"Fraternity Row", ig:"akl_psu"},
    {id:6, name:"Alpha Phi Delta", gl:"ΑΦΔ", addr:"329 E Prospect Ave", street:"Prospect Ave", ig:"apdpsu"},
    {id:7, name:"Alpha Rho Chi", gl:"ΑΡΧ", addr:"320 S Frasier St", street:"Frasier St", ig:"apxvitruvius"},
    {id:8, name:"Alpha Sigma Phi", gl:"ΑΣΦ", addr:"420 E Prospect Ave", street:"Prospect Ave", ig:"alphasig_psu"},
    {id:9, name:"Alpha Tau Omega", gl:"ΑΤΩ", addr:"321 E Fairmount Ave", street:"Fairmount Ave", ig:"atopennstate"},
    {id:10, name:"Alpha Zeta", gl:"ΑΖ", addr:"360 N Burrowes St", street:"Burrowes St", ig:"alphazeta.psu"},
    {id:11, name:"Beta Sigma Beta", gl:"ΒΣΒ", addr:"255 E Fairmount Ave", street:"Fairmount Ave", ig:"betasigmabeta_psu"},
    {id:12, name:"Chi Phi", gl:"ΧΦ", addr:"360 E Hamilton Ave", street:"Hamilton Ave", ig:"chiphipsu"},
    {id:13, name:"Delta Sigma Phi", gl:"ΔΣΦ", addr:"508 Locust Lane", street:"Locust Lane", ig:"deltasigmaphipsu"},
    {id:14, name:"Sigma Nu", gl:"ΣΝ", addr:null, street:"", ig:"psu_sigmanu"},
    {id:15, name:"Delta Upsilon", gl:"ΔΥ", addr:"229 Locust Lane", street:"Locust Lane", ig:"psudeltaupsilon"},
    {id:16, name:"Delta Theta Sigma", gl:"ΔΘΣ", nick:"DTS", addr:"101 N Patterson St", street:"Patterson St", ig:"dtsbeta"},
    {id:17, name:"Theta Delta Chi", gl:"ΘΔΧ", nick:"TDX", addr:"305 E Prospect Ave", street:"Prospect Ave", ig:"tdxpsu"},
    {id:18, name:"Tau Epsilon Phi", gl:"ΤΕΦ", addr:"328 E Foster Ave", street:"Foster Ave", ig:"psu_tep"},
    {id:19, name:"Phi Gamma Delta", gl:"ΦΓΔ", nick:"FIJI", addr:"319 N Burrowes Rd", street:"Burrowes St", ig:"fijipsu"},
    {id:20, name:"Phi Kappa Psi", gl:"ΦΚΨ", addr:"403 Locust Lane", street:"Locust Lane", ig:"phipsipsu"},
    {id:21, name:"Zeta Beta Tau", gl:"ΖΒΤ", nick:"ZBT", addr:"429 E Hamilton Ave", street:"Hamilton Ave", ig:"zbt_psu"},
    {id:22, name:"Phi Kappa Tau", gl:"ΦΚΤ", addr:"408 E Fairmount Ave", street:"Fairmount Ave", ig:"psu_phitau"},
    {id:23, name:"Phi Kappa Theta", gl:"ΦΚΘ", nick:"Phi Who", addr:"338 E Fairmount Ave", street:"Fairmount Ave", ig:"phiwhopsu"},
    {id:24, name:"Phi Sigma Kappa", gl:"ΦΣΚ", addr:"501 S Allen St", street:"Allen St", ig:"phisigpsu"},
    {id:25, name:"Pi Kappa Phi", gl:"ΠΚΦ", nick:"Pi Kapp", addr:"409 E Fairmount Ave", street:"Fairmount Ave", ig:"pikapp_psu"},
    {id:26, name:"Sigma Alpha Epsilon", gl:"ΣΑΕ", addr:"200 E Beaver Ave", street:"Beaver Ave", ig:"sae_psu"},
    {id:27, name:"Sigma Phi Epsilon", gl:"ΣΦΕ", nick:"SigEp", addr:"524 Locust Lane", street:"Locust Lane", ig:"sigep_psu"},
    {id:28, name:"Lambda Chi Alpha", gl:"ΛΧΑ", addr:"351 E Fairmount Ave", street:"Fairmount Ave", ig:"lambdachipsu"},
    {id:29, name:"Tau Phi Delta", gl:"ΤΦΔ", addr:"427 E Fairmount Ave", street:"Fairmount Ave", ig:"tauphideltapsu"},
    {id:30, name:"Theta Chi", gl:"ΘΧ", addr:"523 S Allen St", street:"Allen St", ig:"thetachipsu"},
    {id:31, name:"Phi Delta Theta", gl:"ΦΔΘ", nick:"Phi Delt", addr:"328 E Fairmount Ave", street:"Fairmount Ave", ig:"psuphidelt"},
    {id:32, name:"Triangle", gl:"Δ", addr:"226 E Beaver Ave", street:"Beaver Ave", ig:"psutriangle"},
    {id:33, name:"Kappa Sigma", gl:"ΚΣ", addr:null, street:"", ig:"kappasigpsu"},
    {id:34, name:"Delta Kappa Epsilon", gl:"ΔΚΕ", addr:null, street:"", ig:"dke_pennstate"}
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = CHAPTERS;
  else globalThis.PF_CHAPTERS = CHAPTERS;
})();
