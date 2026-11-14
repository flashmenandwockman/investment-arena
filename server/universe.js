// Universum der täglichen Recherche (Discovery Engine): deutsche Aktien, ETFs, Rohstoffe, Devisen.
// US-Aktien kommen aus dem Tagesverlierer-Screening (gesamter Markt), deshalb hier keine feste Liste.
const DE = ['ADS.DE','AIR.DE','ALV.DE','BAS.DE','BAYN.DE','BEI.DE','BMW.DE','BNR.DE','CBK.DE','CON.DE','1COV.DE','DTG.DE','DBK.DE','DB1.DE','DHL.DE','DTE.DE','EOAN.DE','FRE.DE','FME.DE','HNR1.DE','HEI.DE','HEN3.DE','IFX.DE','MBG.DE','MRK.DE','MTX.DE','MUV2.DE','P911.DE','PAH3.DE','QIA.DE','RHM.DE','RWE.DE','SAP.DE','SRT3.DE','SIE.DE','ENR.DE','SHL.DE','SY1.DE','VOW3.DE','VNA.DE','ZAL.DE',
  'AIXA.DE','AFX.DE','BC8.DE','BOSS.DE','DUE.DE','EVD.DE','EVK.DE','FNTN.DE','FPE3.DE','G1A.DE','GXI.DE','HAG.DE','HOT.DE','JEN.DE','KGX.DE','KRN.DE','LEG.DE','LHA.DE','LXS.DE','NDA.DE','NEM.DE','NDX1.DE','PUM.DE','RAA.DE','S92.DE','SAX.DE','SDF.DE','SIX2.DE','SMHN.DE','TEG.DE','TKA.DE','TLX.DE','TMV.DE','UN01.DE','WAF.DE','WCH.DE',
  '1U1.DE','AOF.DE','BFSA.DE','CWC.DE','DEZ.DE','DRW3.DE','ELG.DE','EUZ.DE','FIE.DE','HBH.DE','HYQ.DE','IOS.DE','KCO.DE','KWS.DE','MBB.DE','NA9.DE','PFV.DE','PSM.DE','R3NK.DE','SZG.DE','VBK.DE','WAC.DE','HLAG.DE','KTN.DE','GFT.DE','COK.DE','SGL.DE','PNE3.DE','ECV.DE','VAR1.DE','SUSS.DE'];
// Zielbranchen der Recherche (Schlüsselwörter in Branche oder Name)
const TARGET = /(semiconductor|halbleiter|robot|automation|automatis|defense|verteidig|aerospace|machinery|maschinen|electrical equipment|energy|energie|hydrogen|wasserstoff|gas|lng|mining|bergbau|cyber|security|software|industrial|sensor|laser|optic|medical|medizin|chip|infrastructure)/i;
const ETF = {
  'SPY':['S&P 500','Breite Märkte'], 'QQQ':['Nasdaq 100','Technologie'], 'URTH':['MSCI World','Breite Märkte'], 'IWM':['Russell 2000 Nebenwerte','Breite Märkte'], 'VGK':['Europa','Länder'], 'EWG':['Deutschland','Länder'], 'EWJ':['Japan','Länder'], 'INDA':['Indien','Länder'], 'FXI':['China Large Caps','Länder'], 'EEM':['Schwellenländer','Länder'],
  'SMH':['Halbleiter','Technologie'], 'SOXX':['Halbleiter (iShares)','Technologie'], 'XLK':['US-Technologie','Technologie'], 'BOTZ':['Robotik & KI','Technologie'], 'ARKK':['Innovation (ARK)','Technologie'], 'HACK':['Cybersecurity','Technologie'],
  'XLI':['US-Industrie','Industrie'], 'PAVE':['Infrastruktur','Industrie'], 'ITA':['Luftfahrt & Verteidigung','Industrie'],
  'XLE':['Energie (Öl & Gas)','Energie'], 'URA':['Uran','Energie'], 'HDRO':['Wasserstoff','Energie'], 'ICLN':['Erneuerbare Energien','Energie'], 'TAN':['Solar','Energie'],
  'GDX':['Goldminen','Rohstoffe & Minen'], 'COPX':['Kupferminen','Rohstoffe & Minen'], 'REMX':['Seltene Erden','Rohstoffe & Minen'], 'LIT':['Lithium & Batterie','Rohstoffe & Minen'], 'SIL':['Silberminen','Rohstoffe & Minen'],
  'XLV':['Gesundheit','Branchen (USA)'], 'XLF':['Finanzen','Branchen (USA)'], 'XLU':['Versorger','Branchen (USA)'], 'XLP':['Basiskonsum','Branchen (USA)'], 'XBI':['Biotech','Branchen (USA)'],
  'TLT':['US-Staatsanleihen 20+','Anleihen'], 'IEF':['US-Staatsanleihen 7-10','Anleihen'], 'LQD':['Unternehmensanleihen','Anleihen'], 'HYG':['Hochzinsanleihen','Anleihen'], 'TIP':['Inflationsgeschützte Anleihen','Anleihen'],
  'SCHD':['Dividendenwachstum','Dividenden & Qualität'], 'QUAL':['Qualität','Dividenden & Qualität'], 'VTV':['Value','Dividenden & Qualität'], 'VNQ':['Immobilien (REITs)','Branchen (USA)'],
};
const CMD = {
  'GC=F':['Gold','Edelmetalle',['GC=F','GDX']], 'SI=F':['Silber','Edelmetalle',['SIL']], 'PL=F':['Platin','Edelmetalle',[]], 'PA=F':['Palladium','Edelmetalle',[]],
  'HG=F':['Kupfer','Industriemetalle',['COPX','FCX','SCCO']], 'ALI=F':['Aluminium','Industriemetalle',['AA','NDA.DE']],
  'NG=F':['Erdgas (Henry Hub)','Energie',['XLE','EQT','UN01.DE']], 'CL=F':['WTI-Öl','Energie',['CL=F','XLE','XOM']], 'BZ=F':['Brent-Öl','Energie',['XLE','SHEL','BP']],
  'ZW=F':['Weizen','Agrar',['KWS.DE','DE']], 'ZC=F':['Mais','Agrar',['DE']], 'ZS=F':['Sojabohnen','Agrar',['ADM','BG']], 'KC=F':['Kaffee','Agrar',['SBUX']],
  'URA':['Uran (ETF)','Strategisch',['CCJ']], 'LIT':['Lithium (ETF)','Batterie',['ALB','SQM']], 'REMX':['Seltene Erden (ETF)','Strategisch',['MP']],
};
// Krypto: Yahoo-Kürzel für die Recherche, Arena-Kürzel (Kraken) zum Handeln
const CRYPTO = {'BTC-EUR':['Bitcoin','BTC/EUR'], 'ETH-EUR':['Ethereum','ETH/EUR'], 'SOL-EUR':['Solana','SOL/EUR'], 'XRP-EUR':['XRP','XRP/EUR'], 'ADA-EUR':['Cardano','ADA/EUR'], 'DOGE-EUR':['Dogecoin','DOGE/EUR'],
  'BNB-EUR':['BNB','BNB/EUR'], 'AVAX-EUR':['Avalanche','AVAX/EUR'], 'LINK-EUR':['Chainlink','LINK/EUR'], 'DOT-EUR':['Polkadot','DOT/EUR'], 'LTC-EUR':['Litecoin','LTC/EUR'], 'TRX-EUR':['Tron','TRX/EUR']};
const FX = ['EURUSD=X','USDJPY=X','GBPUSD=X','USDCHF=X','EURCHF=X','EURGBP=X','AUDUSD=X','USDCAD=X','EURJPY=X','GBPCHF=X','CHFJPY=X','USDCNY=X'];
module.exports = {DE, ETF, CMD, FX, CRYPTO, TARGET};
