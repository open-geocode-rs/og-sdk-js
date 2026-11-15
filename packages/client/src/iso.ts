/**
 * ISO 3166-1 country codes, for providers that name a country by its three-letter code.
 * The unified format uses the two-letter code everywhere.
 * From the Debian `iso-codes` package (`iso_3166-1.json`).
 */

/** Each entry is a two-letter code followed by its three-letter code. */
const CODES: string =
  "ADAND AEARE AFAFG AGATG AIAIA ALALB AMARM AOAGO AQATA ARARG ASASM ATAUT AUAUS AWABW " +
  "AXALA AZAZE BABIH BBBRB BDBGD BEBEL BFBFA BGBGR BHBHR BIBDI BJBEN BLBLM BMBMU BNBRN " +
  "BOBOL BQBES BRBRA BSBHS BTBTN BVBVT BWBWA BYBLR BZBLZ CACAN CCCCK CDCOD CFCAF CGCOG " +
  "CHCHE CICIV CKCOK CLCHL CMCMR CNCHN COCOL CRCRI CUCUB CVCPV CWCUW CXCXR CYCYP CZCZE " +
  "DEDEU DJDJI DKDNK DMDMA DODOM DZDZA ECECU EEEST EGEGY EHESH ERERI ESESP ETETH FIFIN " +
  "FJFJI FKFLK FMFSM FOFRO FRFRA GAGAB GBGBR GDGRD GEGEO GFGUF GGGGY GHGHA GIGIB GLGRL " +
  "GMGMB GNGIN GPGLP GQGNQ GRGRC GSSGS GTGTM GUGUM GWGNB GYGUY HKHKG HMHMD HNHND HRHRV " +
  "HTHTI HUHUN IDIDN IEIRL ILISR IMIMN ININD IOIOT IQIRQ IRIRN ISISL ITITA JEJEY JMJAM " +
  "JOJOR JPJPN KEKEN KGKGZ KHKHM KIKIR KMCOM KNKNA KPPRK KRKOR KWKWT KYCYM KZKAZ LALAO " +
  "LBLBN LCLCA LILIE LKLKA LRLBR LSLSO LTLTU LULUX LVLVA LYLBY MAMAR MCMCO MDMDA MEMNE " +
  "MFMAF MGMDG MHMHL MKMKD MLMLI MMMMR MNMNG MOMAC MPMNP MQMTQ MRMRT MSMSR MTMLT MUMUS " +
  "MVMDV MWMWI MXMEX MYMYS MZMOZ NANAM NCNCL NENER NFNFK NGNGA NINIC NLNLD NONOR NPNPL " +
  "NRNRU NUNIU NZNZL OMOMN PAPAN PEPER PFPYF PGPNG PHPHL PKPAK PLPOL PMSPM PNPCN PRPRI " +
  "PSPSE PTPRT PWPLW PYPRY QAQAT REREU ROROU RSSRB RURUS RWRWA SASAU SBSLB SCSYC SDSDN " +
  "SESWE SGSGP SHSHN SISVN SJSJM SKSVK SLSLE SMSMR SNSEN SOSOM SRSUR SSSSD STSTP SVSLV " +
  "SXSXM SYSYR SZSWZ TCTCA TDTCD TFATF TGTGO THTHA TJTJK TKTKL TLTLS TMTKM TNTUN TOTON " +
  "TRTUR TTTTO TVTUV TWTWN TZTZA UAUKR UGUGA UMUMI USUSA UYURY UZUZB VAVAT VCVCT VEVEN " +
  "VGVGB VIVIR VNVNM VUVUT WFWLF WSWSM YEYEM YTMYT ZAZAF ZMZMB ZWZWE";

let toAlpha3: Map<string, string> | undefined;
let toAlpha2: Map<string, string> | undefined;

function load(): void {
  toAlpha3 = new Map();
  toAlpha2 = new Map();
  for (const entry of CODES.split(" ")) {
    toAlpha3.set(entry.slice(0, 2), entry.slice(2));
    toAlpha2.set(entry.slice(2), entry.slice(0, 2));
  }
}

/** The three-letter code of a two-letter country code, in any case. `undefined` for a code ISO does not list. */
export function alpha3(code: string): string | undefined {
  if (toAlpha3 === undefined) load();
  return toAlpha3?.get(code.toUpperCase());
}

/** The two-letter code of a three-letter country code, in any case. `undefined` for a code ISO does not list. */
export function alpha2(code: string): string | undefined {
  if (toAlpha2 === undefined) load();
  return toAlpha2?.get(code.toUpperCase());
}
