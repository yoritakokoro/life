/* 一世·汉末 —— 本郡情形：治安、粮价、流民
 * 地方上的随机事件，以史实为本：一类是汉魏晋常见的地方行政与民生（开仓赈贷、大姓闭籴、招抚流民、常平仓……），
 * 一类是特定时地的史实（黑山贼、白波贼、泰山贼、葛陂黄巾、关中流民入荆州、山越、鲜卑、羌乱……）。
 * 条件：zones 地区，y 年份，f 统治者，g 政权集团，notF 排除的统治者，oLt 治安低于，pGt 粮价高于，rGt 流民（占本郡人口的百分比）高于。
 * fx：order 治安增减，price 粮价倍数，ref 流民倍数（<1 减少）或 refAdd 流民增加（百分点）。
 */
(function (D) {
  'use strict';
  D.REG_EV = [
    /* ---------- 常见的地方事务 ---------- */
    { id: 'kaicang', w: 3, pGt: 1.5, notF: ['warlords', 'rebels', 'dongzhuo', 'lijue', 'yuanshu'], t: '郡守上书请求开仓赈贷，官仓的粟米按人口分给了贫民。', fx: { price: 0.8, order: 4 } },
    { id: 'bidi', w: 3, pGt: 1.25, t: '郡中的大姓闭门不粜，把粮食囤在仓里，等着价钱再涨。', fx: { price: 1.25, order: -3 } },
    { id: 'liangchuan', w: 2, pGt: 1.2, t: '外郡的粮船、粮车到了，市上的粮价跌了一些。', fx: { price: 0.85 } },
    { id: 'shizhou', w: 3, rGt: 4, t: '郡中的大姓在门外设了粥棚，流民排成了长队。', fx: { ref: 0.85, order: 2 } },
    { id: 'liumindao', w: 3, rGt: 7, oLt: 65, t: '流民聚众抢了乡里大户的粮仓。官府派兵追捕，杀了几十个人，把头挂在了路边。', fx: { order: -10, ref: 0.8 } },
    { id: 'liuminyi', w: 2, rGt: 9, t: '流民中起了疫病，城外的草棚一个接一个空了。', fx: { ref: 0.7, order: -2 } },
    { id: 'zhaofu', w: 3, rGt: 5, y: [196, 300], g: ['wei', 'jin'], t: '官府招抚流民，分给荒田和耕牛，把他们编入户籍。', fx: { ref: 0.5, order: 5 } },
    { id: 'qianfan', w: 2, rGt: 5, y: [200, 300], g: ['wei', 'jin'], t: '官府清查户口，把没有户籍的流民遣送回原籍。', fx: { ref: 0.6, order: 2 } },
    { id: 'buzei', w: 3, oLt: 55, t: '新来的县令捕盗甚严，把几个盗贼的首级挂在了城门上。', fx: { order: 12 } },
    { id: 'jieshi', w: 3, oLt: 50, t: '一伙盗贼劫了县城外的市集，烧了几间铺子。', fx: { order: -8, price: 1.08 } },
    { id: 'wangming', w: 2, oLt: 60, t: '有亡命之徒逃进了山里，聚了几十个人，夜里出来抢掠行旅。', fx: { order: -6 } },
    { id: 'tingzhang', w: 2, y: [150, 219], t: '亭长带着求盗挨家盘查，说是要捉拿亡命之徒。', fx: { order: 4 } },
    { id: 'haoqiang', w: 2, t: '县里的豪强纵容宾客横行乡里，打伤了人，官府也不敢过问。', fx: { order: -5 } },
    { id: 'xunli', w: 1, oLt: 70, t: '新来的县令是个清廉的人，减了些杂役，又亲自下乡劝课农桑。', fx: { order: 6, price: 0.95 } },
    { id: 'changping', w: 3, y: [268, 300], g: ['jin'], t: '朝廷新立常平仓：谷贱时官府加价收籴，谷贵时减价出粜。', fx: { price: 0.85, order: 2 } },
    { id: 'feiliang', w: 2, y: [196, 280], pGt: 1.15, t: '军中缺粮，官府在郡里加征军粮，市上的粮价一下子涨了。', fx: { price: 1.2, order: -2 } },
    /* ---------- 特定时地的史实 ---------- */
    { id: 'heishan', w: 6, zones: ['ji', 'bing'], y: [185, 205], t: '黑山贼出没于太行诸谷，劫掠郡县。人说他们的首领张燕有众百万。', fx: { order: -12 } },
    { id: 'baibo', w: 6, zones: ['luoyang', 'bing'], y: [188, 195], t: '白波贼从西河白波谷出来，寇掠河东，连太原、河内也不得安宁。', fx: { order: -12, price: 1.1 } },
    { id: 'taishan', w: 6, zones: ['xu', 'qing', 'yan'], y: [190, 198], t: '泰山贼臧霸、孙观等人聚众于青徐之间，郡县制不住他们。', fx: { order: -10 } },
    { id: 'gepo', w: 6, zones: ['yu'], y: [190, 196], t: '汝南葛陂的黄巾余部何仪、刘辟、黄邵等人，各拥众数万，出没于汝南、颍川之间。', fx: { order: -12 } },
    { id: 'qinghj', w: 6, zones: ['qing', 'yan'], y: [189, 192], t: '青州黄巾号称百万，转入兖州，所过郡县残破，男女老幼拖家带口地跟着走。', fx: { order: -15, refAdd: 6 } },
    { id: 'jingliu', w: 6, zones: ['jingbei', 'jingnan'], y: [193, 205], t: '关中、南阳的流民一批批涌进荆州。后来卫觊说："人民流入荆州者十万余家。"', fx: { refAdd: 8, price: 1.1 } },
    { id: 'liubiaofu', w: 4, rGt: 4, f: ['liubiao'], t: '荆州牧派人安抚流民，让他们在汉水两岸开荒，又把北方来的士人安置在学官里。', fx: { ref: 0.7, order: 3 } },
    { id: 'shanyue', w: 5, zones: ['jiangdong', 'huainan', 'jingnan'], y: [196, 240], t: '山越宗部出山抄掠，县里闭了城门。', fx: { order: -10 } },
    { id: 'jiangzei', w: 3, zones: ['jiangdong', 'huainan', 'jingnan', 'jingbei'], y: [188, 235], t: '江上有水贼出没，商船只敢结队而行，盐和布的价钱都涨了。', fx: { order: -6, price: 1.05 } },
    { id: 'nanzhongyi', w: 5, zones: ['nanzhong'], y: [223, 250], t: '南中的夷帅又起兵了，杀了郡吏，郡里调兵去讨。', fx: { order: -10 } },
    { id: 'xianbei', w: 4, zones: ['you', 'bing', 'liang'], y: [160, 235], t: '鲜卑骑兵越过边塞抄掠，掳走了好些人口和牲畜。', fx: { order: -10 } },
    { id: 'qiang', w: 4, zones: ['liang', 'guanzhong'], y: [160, 220], t: '羌人又反了，凉州的道路断了好几个月。', fx: { order: -10, price: 1.1 } },
    { id: 'wuhuan', w: 4, zones: ['you', 'ji'], y: [187, 206], t: '乌桓骑兵南下抄掠，掳走了上万户人家。', fx: { order: -12, refAdd: 3 } },
    { id: 'jiaozei', w: 3, zones: ['jiao'], y: [160, 280], t: '交趾、九真一带的俚人起兵，攻打郡县。', fx: { order: -8 } },
    { id: 'qinyong', w: 6, zones: ['shu', 'hanzhong'], y: [296, 301], t: '秦、雍二州连年饥荒，流民数万家沿着汉川涌入蜀中。', fx: { refAdd: 10, price: 1.2 } },
    { id: 'wuzhu', w: 5, zones: ['yu', 'yan', 'luoyang', 'xu', 'qing'], y: [311, 330], t: '附近的坞主筑坞自守，收容流民，一会儿向后赵称臣，一会儿向东晋称臣。', fx: { order: -4, ref: 0.85 } },
    { id: 'nandu', w: 6, zones: ['jiangdong', 'huainan', 'jingbei', 'jingnan'], y: [311, 330], t: '北方的流民扶老携幼渡过淮河、长江，在江边搭起了草棚。', fx: { refAdd: 8, price: 1.1 } },
    { id: 'nandu2', w: 6, zones: ['jiangdong', 'huainan', 'jingbei'], y: [349, 350], t: '北方大乱，又一批流民渡江南来，说中原已经"人相食"了。', fx: { refAdd: 10, price: 1.15 } },
    { id: 'liuminshuai', w: 4, zones: ['huainan', 'xu'], y: [313, 330], t: '流民帅带着几千家部曲屯在淮水边，朝廷封了他官，可谁也管不了他。', fx: { order: -6 } },
    { id: 'jiebing', w: 4, g: ['other'], f: ['houzhao'], y: [319, 349], t: '一队羯人兵士进村征粮，见了好东西就拿，见了女人就抢，里正一句话也不敢说。', fx: { order: -10 } },
    { id: 'zhangchang', w: 6, zones: ['jingbei', 'jingnan'], y: [303, 304], t: '义阳蛮张昌聚众起事，荆州的流民纷纷归附，郡县大乱。', fx: { order: -18 } }
  ];
})(SGD);
