// Penn State sororities, from greekrank.net/uni/44/sororities (November 2026). Shared by the sorority
// portal, the frat portal's sorority invites, the control room and the server.
(function () {
  const SORORITIES = [
    {id:1, name:"Alpha Chi Omega", gl:"ΑΧΩ"},
    {id:2, name:"Alpha Delta Pi", gl:"ΑΔΠ"},
    {id:3, name:"Alpha Kappa Alpha", gl:"ΑΚΑ"},
    {id:4, name:"Alpha Omicron Pi", gl:"ΑΟΠ"},
    {id:5, name:"Alpha Phi", gl:"ΑΦ"},
    {id:6, name:"Alpha Sigma Alpha", gl:"ΑΣΑ"},
    {id:7, name:"Alpha Xi Delta", gl:"ΑΞΔ"},
    {id:8, name:"Chi Omega", gl:"ΧΩ"},
    {id:9, name:"Delta Delta Delta", gl:"ΔΔΔ"},
    {id:10, name:"Delta Gamma", gl:"ΔΓ"},
    {id:11, name:"Delta Phi Epsilon", gl:"ΔΦΕ"},
    {id:12, name:"Delta Zeta", gl:"ΔΖ"},
    {id:13, name:"Gamma Phi Beta", gl:"ΓΦΒ"},
    {id:14, name:"Gamma Sigma Sigma", gl:"ΓΣΣ"},
    {id:15, name:"Kappa Alpha Theta", gl:"ΚΑΘ"},
    {id:16, name:"Kappa Beta Gamma", gl:"ΚΒΓ"},
    {id:17, name:"Kappa Delta", gl:"ΚΔ"},
    {id:18, name:"Kappa Kappa Gamma", gl:"ΚΚΓ"},
    {id:19, name:"Omega Phi Alpha", gl:"ΩΦΑ"},
    {id:20, name:"Phi Mu", gl:"ΦΜ"},
    {id:21, name:"Phi Sigma Rho", gl:"ΦΣΡ"},
    {id:22, name:"Phi Sigma Sigma", gl:"ΦΣΣ"},
    {id:23, name:"Pi Beta Phi", gl:"ΠΒΦ"},
    {id:24, name:"Sigma Alpha", gl:"ΣΑ"},
    {id:25, name:"Sigma Delta Tau", gl:"ΣΔΤ"},
    {id:26, name:"Sigma Gamma Rho", gl:"ΣΓΡ"},
    {id:27, name:"Sigma Kappa", gl:"ΣΚ"},
    {id:28, name:"Sigma Sigma Sigma", gl:"ΣΣΣ"},
    {id:29, name:"Zeta Phi Beta", gl:"ΖΦΒ"},
    {id:30, name:"Zeta Tau Alpha", gl:"ΖΤΑ"}
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = SORORITIES;
  else globalThis.PF_SORORITIES = SORORITIES;
})();
