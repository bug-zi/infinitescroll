import { JOURNEY_TO_WEST_TEMPLATE, JOURNEY_TO_WEST_TEMPLATE_VERSION, JOURNEY_TO_WEST_TOTAL_FRAMES } from "./storyMode";

export type StoryboardFrame = {
  frameIndex: number;
  chapter: string;
  title: string;
  scene: string;
  characters: string[];
  location: string;
  mood: string;
  continuityAnchor: string;
  forbidden: string;
};

type StoryArc = {
  chapter: string;
  location: string;
  mood: string;
  characters: string[];
  beats: Array<{
    title: string;
    scene: string;
    continuityAnchor?: string;
    forbidden?: string;
    characters?: string[];
    location?: string;
    mood?: string;
  }>;
};

const DEFAULT_STORY_FORBIDDEN = "只画当前剧情帧，不得提前画后续剧情，不得跳过剧情，不得改编成无关山水或市井空景，不得改变主要人物身份。";
const DEFAULT_STORY_CONTINUITY = "采用分镜长卷衔接：用云气、山水、卷轴纹理、道路方向和统一色调承接上一帧，不强求同一地点无缝连续。";

const STORY_ARCS: StoryArc[] = [
  {
    chapter: "花果山石猴",
    location: "东胜神洲傲来国花果山",
    mood: "神异初生",
    characters: ["石猴", "群猴"],
    beats: [
      { title: "石猴出世", scene: "仙石吸收日月精华后崩裂，石猴跃出，金光映照花果山瀑布与古松。" },
      { title: "群猴拜王", scene: "石猴穿过水帘洞，群猴在洞口欢呼拜王，水雾与藤蔓形成卷轴式过渡。" },
      { title: "美猴王宴乐", scene: "美猴王在水帘洞中与群猴饮果嬉戏，洞外瀑布向右延展为下一段动线。" },
      { title: "忽悟生死", scene: "美猴王见老猴衰亡，独坐崖边望海，欢乐气氛转为求道的沉思。" },
    ],
  },
  {
    chapter: "求仙访道",
    location: "东海与南赡部洲",
    mood: "孤勇远行",
    characters: ["石猴", "樵夫", "菩提祖师"],
    beats: [
      { title: "漂洋过海", scene: "石猴扎木筏远渡重洋，海天辽阔，浪线横向引出远方陆地。" },
      { title: "市井寻师", scene: "石猴穿行人间市镇，观察衣冠礼法，远处山路指向仙山。" },
      { title: "灵台方寸山", scene: "石猴沿松径登山，樵夫指引斜月三星洞，云雾遮出洞府入口。" },
      { title: "拜见祖师", scene: "菩提祖师端坐讲坛，石猴俯首拜师，众弟子分列两旁。" },
    ],
  },
  {
    chapter: "学艺归山",
    location: "斜月三星洞与花果山",
    mood: "神通初成",
    characters: ["孙悟空", "菩提祖师", "群猴", "混世魔王"],
    beats: [
      { title: "赐名悟空", scene: "祖师为石猴赐名孙悟空，殿内烛光与云纹形成庄严气氛。", characters: ["孙悟空", "菩提祖师"] },
      { title: "七十二变", scene: "孙悟空在松林间练习变化，身影化作飞鸟走兽，保持连环画式分身节奏。" },
      { title: "筋斗云成", scene: "孙悟空踏云翻腾，山峰与云路横向铺开，表现一纵十万八千里的速度。" },
      { title: "降混世魔王", scene: "孙悟空回花果山，挥棒击败混世魔王，群猴在洞口迎回大王。" },
    ],
  },
  {
    chapter: "龙宫借宝",
    location: "东海龙宫",
    mood: "奇珍瑰丽",
    characters: ["孙悟空", "东海龙王", "龙子龙孙", "龟丞相"],
    beats: [
      { title: "入海访龙宫", scene: "孙悟空分水入海，龙宫珊瑚殿宇在蓝绿色水光中展开。" },
      { title: "试诸兵器", scene: "龙王呈上刀枪画戟，孙悟空逐一试举，兵器横列成连环画格。" },
      { title: "金箍棒认主", scene: "定海神针金光暴涨，孙悟空单手举起如意金箍棒，海水翻涌。" },
      { title: "披挂齐全", scene: "孙悟空戴凤翅紫金冠、穿锁子黄金甲、踏藕丝步云履，龙族惊惧退让。" },
    ],
  },
  {
    chapter: "地府销名",
    location: "幽冥地府",
    mood: "阴森凌厉",
    characters: ["孙悟空", "阎王", "判官", "鬼卒"],
    beats: [
      { title: "魂入幽冥", scene: "鬼卒误勾孙悟空魂魄，阴风纸钱与黑雾铺成地府入口。" },
      { title: "大闹森罗殿", scene: "孙悟空挥棒闯入森罗殿，十殿阎王惊慌退避。" },
      { title: "生死簿除名", scene: "孙悟空翻开生死簿，划去猴属名号，判官捧册颤抖。" },
      { title: "回返花果山", scene: "孙悟空破雾而出，群猴迎接，大地由幽暗转回花果山暖色。" },
    ],
  },
  {
    chapter: "天庭招安",
    location: "南天门与御马监",
    mood: "仙界压抑",
    characters: ["孙悟空", "太白金星", "玉帝", "天兵", "天马"],
    beats: [
      { title: "太白招安", scene: "太白金星降临花果山，奉旨招安孙悟空，云阶通往天庭。" },
      { title: "初入南天门", scene: "孙悟空随太白过南天门，天兵列阵，仙宫层层向右展开。" },
      { title: "弼马温任职", scene: "孙悟空在御马监照看天马，仙马奔腾，马厩云栏延展。" },
      { title: "怒知官小", scene: "孙悟空得知弼马温卑微，怒掀案几，天马惊散。" },
    ],
  },
  {
    chapter: "齐天大圣",
    location: "花果山与天宫",
    mood: "反叛高涨",
    characters: ["孙悟空", "独角鬼王", "托塔天王", "哪吒"],
    beats: [
      { title: "自封齐天", scene: "孙悟空回花果山，高挂齐天大圣旗，群妖聚集山门。" },
      { title: "天兵压境", scene: "托塔天王率天兵天将压到花果山，云阵与山势对峙。" },
      { title: "哪吒斗圣", scene: "哪吒三头六臂大战孙悟空，金箍棒与火尖枪交错。" },
      { title: "天庭再招", scene: "天庭无奈再次招安，孙悟空昂然入天宫，气势不减。" },
    ],
  },
  {
    chapter: "蟠桃会乱",
    location: "蟠桃园与瑶池",
    mood: "华丽失控",
    characters: ["孙悟空", "七仙女", "王母", "仙官"],
    beats: [
      { title: "看守蟠桃园", scene: "孙悟空进入蟠桃园，满园仙桃累累，云霞与枝叶横向铺展。" },
      { title: "偷吃仙桃", scene: "孙悟空在桃树间大嚼仙桃，仙女远处惊讶回望。" },
      { title: "搅乱蟠桃会", scene: "瑶池宴席杯盘狼藉，孙悟空隐身穿行，仙官纷乱。" },
      { title: "偷丹醉返", scene: "孙悟空闯兜率宫吞仙丹，醉意朦胧中返回花果山。" },
    ],
  },
  {
    chapter: "大闹天宫",
    location: "天宫战场",
    mood: "恢弘激战",
    characters: ["孙悟空", "二郎神", "李天王", "天兵天将"],
    beats: [
      { title: "十万天兵围山", scene: "天兵天将布满云端，花果山旌旗猎猎，孙悟空立于山巅迎战。" },
      { title: "斗二郎神", scene: "孙悟空与二郎神变化斗法，鹰犬与云雾穿插在战场中。" },
      { title: "老君套圣", scene: "太上老君掷金刚琢，孙悟空被击中，天兵合围。" },
      { title: "八卦炉炼猴", scene: "孙悟空被投入八卦炉，炉火熊熊，眼中金光将破炉而出。" },
    ],
  },
  {
    chapter: "五行山下",
    location: "五行山",
    mood: "压抑等待",
    characters: ["孙悟空", "如来佛祖", "山神土地"],
    beats: [
      { title: "掌压五行山", scene: "如来佛掌化作五行山镇压孙悟空，山体横亘画面。" },
      { title: "山下五百年", scene: "孙悟空只露头手，风霜雨雪在山脚轮转，时间感横向铺开。" },
      { title: "观音寻取经人", scene: "观音菩萨云游东土，远方长安城隐现，开启取经线索。", characters: ["观音菩萨", "惠岸行者"] },
      { title: "金蝉转世", scene: "唐僧在长安寺院诵经，佛光与香烟提示取经使命。", characters: ["唐僧"] },
    ],
  },
  {
    chapter: "唐僧出发",
    location: "长安与两界山",
    mood: "庄重启程",
    characters: ["唐僧", "唐太宗", "孙悟空"],
    beats: [
      { title: "水陆大会", scene: "长安水陆大会庄严举行，唐僧登坛讲经，百姓与僧众环绕。" },
      { title: "太宗送行", scene: "唐太宗为唐僧送行，赐通关文牒，城门外旌旗与驿道延伸。" },
      { title: "双叉岭遇险", scene: "唐僧初入荒岭遭妖怪惊吓，随从离散，山路阴森。" },
      { title: "揭帖救悟空", scene: "唐僧在五行山揭下佛帖，孙悟空破山而出，师徒初遇。" },
    ],
  },
  {
    chapter: "收服悟空",
    location: "鹰愁涧前山路",
    mood: "师徒磨合",
    characters: ["唐僧", "孙悟空", "观音菩萨"],
    beats: [
      { title: "初护唐僧", scene: "孙悟空护送唐僧上路，山道崎岖，师徒一前一后形成长卷动线。" },
      { title: "杀贼生隙", scene: "孙悟空打死强盗，唐僧惊惧责备，二人情绪对立。" },
      { title: "紧箍咒起", scene: "观音化身授紧箍，唐僧念咒，孙悟空抱头翻滚。" },
      { title: "师徒定约", scene: "孙悟空收敛桀骜，重新拜护唐僧，远路向西展开。" },
    ],
  },
  {
    chapter: "白龙马",
    location: "鹰愁涧",
    mood: "惊险转折",
    characters: ["唐僧", "孙悟空", "小白龙", "观音菩萨"],
    beats: [
      { title: "白龙吞马", scene: "鹰愁涧水浪暴起，小白龙吞下唐僧坐骑，唐僧惊慌。" },
      { title: "悟空战白龙", scene: "孙悟空在涧边与白龙翻江斗法，水花贯穿画面。" },
      { title: "菩萨点化", scene: "观音现身点化小白龙，龙影收敛，水面归于平静。" },
      { title: "化作白马", scene: "小白龙化为白马驮唐僧西行，队伍重新上路。" },
    ],
  },
  {
    chapter: "高老庄八戒",
    location: "高老庄",
    mood: "诙谐妖气",
    characters: ["唐僧", "孙悟空", "猪八戒", "高小姐"],
    beats: [
      { title: "借宿高老庄", scene: "唐僧师徒投宿高老庄，庄院灯火不安，村民低声诉苦。" },
      { title: "妖婿现形", scene: "猪刚鬣夜入绣房，孙悟空暗中观察，喜剧与妖气并存。" },
      { title: "云栈洞斗法", scene: "孙悟空追至云栈洞，与猪刚鬣在洞前交战。" },
      { title: "八戒拜师", scene: "猪八戒放下钉耙拜唐僧为师，队伍增添新成员。" },
    ],
  },
  {
    chapter: "黄风岭",
    location: "黄风岭",
    mood: "风沙迷离",
    characters: ["唐僧", "孙悟空", "猪八戒", "黄风怪", "灵吉菩萨"],
    beats: [
      { title: "黄风卷路", scene: "黄风岭狂沙蔽日，唐僧师徒艰难前行。" },
      { title: "唐僧被擒", scene: "黄风怪趁风掳走唐僧，八戒惊慌，悟空追风。" },
      { title: "悟空眼伤", scene: "孙悟空被三昧神风吹伤眼睛，山石与沙尘横扫画面。" },
      { title: "定风降妖", scene: "灵吉菩萨以定风丹相助，孙悟空降服黄风怪。" },
    ],
  },
  {
    chapter: "流沙河沙僧",
    location: "流沙河",
    mood: "沉重肃杀",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "观音菩萨"],
    beats: [
      { title: "流沙河阻路", scene: "八百里流沙河横在西行路上，河水昏黄，骷髅项链隐现。" },
      { title: "八戒水战", scene: "猪八戒下河与沙僧交战，浪涛翻涌，悟空在岸边策应。" },
      { title: "木叉点化", scene: "惠岸行者奉观音法旨点化沙僧，河面风浪渐息。" },
      { title: "沙僧入队", scene: "沙僧挑担随师徒西行，四众与白马队形完整。" },
    ],
  },
  {
    chapter: "四圣试禅心",
    location: "山庄幻境",
    mood: "试炼微妙",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "四圣化身"],
    beats: [
      { title: "荒野遇庄", scene: "师徒夜行遇华丽庄院，灯火温暖却带幻境气息。" },
      { title: "美妇招亲", scene: "四圣化作母女试探师徒禅心，八戒神情动摇。" },
      { title: "八戒受缚", scene: "猪八戒贪念暴露，被珍珠汗衫捆缚吊起。" },
      { title: "幻境消散", scene: "庄院化作荒野，师徒继续西行，悟空含笑看八戒。" },
    ],
  },
  {
    chapter: "五庄观人参果",
    location: "万寿山五庄观",
    mood: "仙府纠葛",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "镇元大仙"],
    beats: [
      { title: "五庄观借宿", scene: "师徒进入五庄观，人参果树枝叶奇异，仙童迎客。" },
      { title: "八戒怂恿偷果", scene: "猪八戒贪嘴怂恿，悟空摘下娃娃形人参果。" },
      { title: "推倒果树", scene: "孙悟空怒推人参果树，仙府震动，清风明月惊呼。" },
      { title: "观音救树", scene: "观音以甘露救活果树，镇元大仙与师徒和解。" },
    ],
  },
  {
    chapter: "白骨精三变",
    location: "白虎岭",
    mood: "阴冷误会",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "白骨精"],
    beats: [
      { title: "少女送斋", scene: "白骨精化作少女提篮送斋，荒岭白雾缠绕。" },
      { title: "老妇寻女", scene: "白骨精再化老妇哭喊寻女，唐僧心软，悟空警觉。" },
      { title: "老翁问路", scene: "白骨精三化老翁，阴影中白骨妖气若隐若现。" },
      { title: "逐走悟空", scene: "唐僧误信八戒谗言赶走悟空，山路空阔，师徒离心。" },
    ],
  },
  {
    chapter: "宝象国黄袍怪",
    location: "宝象国与波月洞",
    mood: "离散危急",
    characters: ["唐僧", "猪八戒", "沙僧", "孙悟空", "黄袍怪", "百花羞"],
    beats: [
      { title: "唐僧被变虎", scene: "黄袍怪施法将唐僧变作猛虎，宝象国殿上大乱。" },
      { title: "八戒请悟空", scene: "猪八戒到花果山请回孙悟空，山中猴群簇拥。" },
      { title: "识破奎木狼", scene: "孙悟空查明黄袍怪本为奎木狼，星宿妖气照亮洞府。" },
      { title: "救回唐僧", scene: "孙悟空降服黄袍怪，唐僧恢复人身，师徒重聚。" },
    ],
  },
  {
    chapter: "平顶山莲花洞",
    location: "平顶山莲花洞",
    mood: "法宝奇险",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "金角大王", "银角大王"],
    beats: [
      { title: "金银角设伏", scene: "金角银角在平顶山设伏，妖洞旌旗与山路交错。" },
      { title: "宝葫芦收人", scene: "紫金红葫芦与羊脂玉净瓶显威，师徒陷入危机。" },
      { title: "悟空骗宝", scene: "孙悟空变化周旋，巧骗妖怪法宝，动作诙谐紧张。" },
      { title: "老君收童子", scene: "太上老君现身收回童子，莲花洞妖气散去。" },
    ],
  },
  {
    chapter: "乌鸡国救主",
    location: "乌鸡国",
    mood: "宫廷悬疑",
    characters: ["唐僧", "孙悟空", "猪八戒", "乌鸡国王", "假国王"],
    beats: [
      { title: "梦中诉冤", scene: "乌鸡国王魂魄夜入唐僧梦中诉冤，宫墙月色阴冷。" },
      { title: "井底捞尸", scene: "猪八戒下井背出真国王尸身，井水幽深。" },
      { title: "灵丹还魂", scene: "孙悟空求来仙丹救活国王，寝殿烛光转暖。" },
      { title: "揭穿妖道", scene: "假国王现出妖身，悟空当殿降妖，朝臣震惊。" },
    ],
  },
  {
    chapter: "车迟国斗法",
    location: "车迟国",
    mood: "斗法戏剧",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "虎力大仙", "鹿力大仙", "羊力大仙"],
    beats: [
      { title: "僧人受苦", scene: "车迟国僧人被迫劳役，道士高坐，师徒暗中观察。" },
      { title: "祈雨斗法", scene: "孙悟空与三大仙坛上祈雨斗法，云层聚散。" },
      { title: "隔板猜物", scene: "悟空暗中变化戏弄道士，王宫斗法场景紧凑。" },
      { title: "三妖伏诛", scene: "虎鹿羊三妖现形败亡，国王释放僧众。" },
    ],
  },
  {
    chapter: "通天河",
    location: "通天河陈家庄",
    mood: "水寒惊险",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "灵感大王", "老鼋"],
    beats: [
      { title: "陈家庄祭童", scene: "村民准备祭献童男童女，通天河寒雾弥漫。" },
      { title: "悟空八戒代童", scene: "悟空八戒变作童子坐入祭台，妖风从河面卷来。" },
      { title: "灵感大王水府", scene: "灵感大王掳唐僧入水府，鱼鳞宫殿幽蓝。" },
      { title: "老鼋渡河", scene: "观音收服金鱼精，老鼋驮师徒过通天河。" },
    ],
  },
  {
    chapter: "女儿国",
    location: "西梁女国",
    mood: "温柔诱惑",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "女儿国国王"],
    beats: [
      { title: "误饮子母河", scene: "唐僧八戒误饮子母河水腹痛，女国街市围观。" },
      { title: "落胎泉求水", scene: "悟空前往落胎泉求水，山泉与守泉道人构成奇景。" },
      { title: "女王留婚", scene: "女儿国王华服相邀，唐僧端坐克制，宫殿柔光。" },
      { title: "蝎子精掳僧", scene: "蝎子精突现掳走唐僧，温柔宫廷转为妖气洞府。" },
    ],
  },
  {
    chapter: "真假美猴王",
    location: "取经路与灵山",
    mood: "真假难辨",
    characters: ["唐僧", "孙悟空", "六耳猕猴", "猪八戒", "沙僧", "如来佛祖"],
    beats: [
      { title: "二心生乱", scene: "假悟空打伤唐僧抢走行李，取经队伍惊散。" },
      { title: "双猴大战", scene: "两个孙悟空形貌相同，在云端与山岭间激烈交战。" },
      { title: "诸神难辨", scene: "天庭地府众神围观辨认，却无法分清真假。" },
      { title: "如来定真", scene: "如来在灵山揭破六耳猕猴，真悟空重新归队。" },
    ],
  },
  {
    chapter: "火焰山",
    location: "火焰山与芭蕉洞",
    mood: "炽热艰难",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "铁扇公主", "牛魔王", "红孩儿"],
    beats: [
      { title: "火焰阻路", scene: "火焰山烈火横亘，师徒与白马在热浪前停步。" },
      { title: "一借芭蕉扇", scene: "孙悟空到芭蕉洞借扇，铁扇公主怒拒挥扇。" },
      { title: "牛魔王斗法", scene: "孙悟空与牛魔王变化大战，火云与山石翻滚。" },
      { title: "三调芭蕉扇", scene: "悟空最终得扇灭火，烈焰化作清风道路。" },
    ],
  },
  {
    chapter: "祭赛国与小雷音",
    location: "祭赛国金光寺与小雷音寺",
    mood: "佛光真假",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "九头虫", "黄眉怪", "弥勒佛"],
    beats: [
      { title: "金光寺蒙冤", scene: "祭赛国金光寺佛宝失窃，僧众受冤，塔影昏暗。" },
      { title: "九头虫盗宝", scene: "九头虫与万圣公主水府藏宝，悟空八戒追查。" },
      { title: "误入小雷音", scene: "唐僧误以为到灵山，进入金碧辉煌的小雷音寺。" },
      { title: "弥勒收黄眉", scene: "黄眉怪现形，弥勒佛以布袋收妖，假佛光散去。" },
    ],
  },
  {
    chapter: "朱紫国",
    location: "朱紫国与麒麟山",
    mood: "医病救国",
    characters: ["唐僧", "孙悟空", "朱紫国王", "金圣宫娘娘", "赛太岁"],
    beats: [
      { title: "国王重病", scene: "朱紫国王病卧宫中，唐僧师徒入朝问诊。" },
      { title: "悟空配药", scene: "孙悟空巧配乌金丹，宫廷药案与香炉细节丰富。" },
      { title: "赛太岁洞府", scene: "悟空潜入麒麟山妖洞，金铃与妖兵守卫森严。" },
      { title: "救回娘娘", scene: "悟空降服赛太岁，金圣宫娘娘归国，宫廷重明。" },
    ],
  },
  {
    chapter: "盘丝洞",
    location: "盘丝洞与黄花观",
    mood: "诡艳危机",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "蜘蛛精", "百眼魔君"],
    beats: [
      { title: "盘丝洞女妖", scene: "蜘蛛精在泉边织丝设陷，洞府蛛网密布。" },
      { title: "八戒遭缠", scene: "猪八戒被蛛丝缠住，动作滑稽又危险。" },
      { title: "黄花观毒茶", scene: "百眼魔君在黄花观设毒茶害唐僧师徒。" },
      { title: "毗蓝婆破妖", scene: "毗蓝婆菩萨以绣花针破百眼金光，妖气消散。" },
    ],
  },
  {
    chapter: "狮驼岭",
    location: "狮驼岭与狮驼城",
    mood: "黑暗压迫",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "青狮", "白象", "大鹏"],
    beats: [
      { title: "狮驼岭尸山", scene: "师徒进入狮驼岭，荒山阴森，妖气压城。" },
      { title: "三魔显威", scene: "青狮白象大鹏三魔登场，妖兵遍布城门。" },
      { title: "悟空入瓶", scene: "孙悟空被阴阳二气瓶困住，瓶内火光与黑气交织。" },
      { title: "佛祖收鹏", scene: "如来现身收服大鹏，狮驼城阴霾被佛光破开。" },
    ],
  },
  {
    chapter: "比丘国",
    location: "比丘国",
    mood: "邪术惊悚",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "鹿力妖道", "白面狐狸"],
    beats: [
      { title: "童子入笼", scene: "比丘国街头摆满童子笼，百姓愁苦，宫城阴暗。" },
      { title: "国丈献药", scene: "妖道国丈献长生药方，狐狸美后在帘后窥视。" },
      { title: "悟空救童", scene: "孙悟空夜入宫城救出孩童，灯影紧张。" },
      { title: "妖道现形", scene: "白鹿与狐狸妖相继现形，师徒破除邪术。" },
    ],
  },
  {
    chapter: "无底洞",
    location: "陷空山无底洞",
    mood: "幽深纠缠",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "金鼻白毛老鼠精", "李天王", "哪吒"],
    beats: [
      { title: "女妖诱僧", scene: "老鼠精化作女子倒卧林间，唐僧慈悲相救。" },
      { title: "陷入无底洞", scene: "唐僧被掳入无底洞，洞道层层向下延伸。" },
      { title: "悟空查牌位", scene: "孙悟空发现李天王父女牌位，线索指向天庭。" },
      { title: "天王缚妖", scene: "李天王与哪吒下界收伏老鼠精，唐僧脱险。" },
    ],
  },
  {
    chapter: "灭法国",
    location: "灭法国",
    mood: "乔装机智",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "灭法国王"],
    beats: [
      { title: "国王灭僧", scene: "灭法国王悬令杀僧，城门榜文森然。" },
      { title: "师徒乔装", scene: "师徒剃发乔装藏身柜中，市井气氛紧张。" },
      { title: "悟空夜剃王宫", scene: "孙悟空夜入王宫，将国王后妃头发剃去，诙谐荒诞。" },
      { title: "国王悔悟", scene: "国王惊醒悔悟，改灭法国为钦法国，师徒通行。" },
    ],
  },
  {
    chapter: "凤仙郡求雨",
    location: "凤仙郡",
    mood: "旱灾悲悯",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "凤仙郡侯", "玉帝"],
    beats: [
      { title: "三年大旱", scene: "凤仙郡土地龟裂，百姓求水，师徒入城。" },
      { title: "郡侯悔罪", scene: "郡侯忏悔冒犯上天之罪，香案与旱田并置。" },
      { title: "悟空上天求雨", scene: "孙悟空上天庭请命，雷部风云聚集。" },
      { title: "甘霖普降", scene: "大雨落下，百姓欢呼，师徒在雨中继续西行。" },
    ],
  },
  {
    chapter: "玉华州传艺",
    location: "玉华州",
    mood: "传承轻快",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "玉华王子", "黄狮精"],
    beats: [
      { title: "王子拜师", scene: "玉华州三位王子拜悟空八戒沙僧学艺，庭院开阔。" },
      { title: "兵器被盗", scene: "黄狮精偷走金箍棒、钉耙、禅杖，妖洞陈列宝光。" },
      { title: "竹节山追妖", scene: "师徒追至竹节山，群狮妖怪列阵。" },
      { title: "九灵元圣收伏", scene: "太乙救苦天尊收回九灵元圣，王子谢师。" },
    ],
  },
  {
    chapter: "金平府",
    location: "金平府青龙山",
    mood: "灯火诡谲",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "犀牛精"],
    beats: [
      { title: "元宵观灯", scene: "金平府元宵灯会繁华，唐僧观灯，暗处妖气潜伏。" },
      { title: "假佛掳僧", scene: "三只犀牛精化作佛像收取香油，趁乱掳走唐僧。" },
      { title: "青龙山大战", scene: "悟空八戒沙僧追至青龙山，与犀牛精水陆交战。" },
      { title: "四木禽星助战", scene: "天上四木禽星降临相助，犀牛精伏诛，灯火重明。" },
    ],
  },
  {
    chapter: "天竺国玉兔",
    location: "天竺国",
    mood: "真假公主",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "天竺公主", "玉兔精", "嫦娥"],
    beats: [
      { title: "布金寺遇真公主", scene: "真公主流落寺中诉说冤情，唐僧师徒倾听。" },
      { title: "假公主招亲", scene: "玉兔精冒充公主设绣球招亲，宫廷华丽却暗藏妖气。" },
      { title: "悟空识妖", scene: "孙悟空火眼金睛识破玉兔，金箍棒指向假公主。" },
      { title: "嫦娥收兔", scene: "嫦娥下界收回玉兔，真公主归位，师徒继续西行。" },
    ],
  },
  {
    chapter: "灵山将近",
    location: "灵山脚下",
    mood: "终点在望",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "白龙马"],
    beats: [
      { title: "望见灵山", scene: "师徒远望灵山佛光，山路明净，白马缓行。" },
      { title: "凌云渡脱凡", scene: "唐僧在凌云渡登无底船，凡胎旧身顺水漂去。" },
      { title: "雷音寺礼佛", scene: "师徒入大雷音寺，诸佛菩萨列座，金光庄严。" },
      { title: "初取无字经", scene: "阿傩迦叶传无字经，师徒疑惑，卷轴空白。" },
    ],
  },
  {
    chapter: "取得真经",
    location: "大雷音寺与归途",
    mood: "圆满庄严",
    characters: ["唐僧", "孙悟空", "猪八戒", "沙僧", "白龙马", "如来佛祖"],
    beats: [
      { title: "换取有字经", scene: "师徒回见如来，重新取得有字真经，经卷金光灿然。" },
      { title: "通天河落水", scene: "老鼋因未得问寿答案翻身，师徒经卷落水，众人抢救。" },
      { title: "晒经石", scene: "师徒在石上晒经，部分经页粘破，山风吹动经卷。" },
      { title: "功德圆满", scene: "师徒回灵山受封，唐僧成佛、悟空成斗战胜佛，八戒沙僧白龙马各得正果。", continuityAnchor: "以佛光、祥云和卷轴收束全卷，形成最终圆满帧。", forbidden: "这是西游记剧情模板最后一帧，不得继续扩写新劫难或无关续集。" },
    ],
  },
];

const SELECTED_STORY_ARCS = [...STORY_ARCS.slice(0, 31), STORY_ARCS[STORY_ARCS.length - 1]];

export const JOURNEY_TO_WEST_STORYBOARD: StoryboardFrame[] = SELECTED_STORY_ARCS.flatMap((arc) =>
  arc.beats.map((beat, beatIndex) => ({
    frameIndex: 0,
    chapter: arc.chapter,
    title: beat.title,
    scene: beat.scene,
    characters: beat.characters ?? arc.characters,
    location: beat.location ?? arc.location,
    mood: beat.mood ?? arc.mood,
    continuityAnchor: beat.continuityAnchor ?? DEFAULT_STORY_CONTINUITY,
    forbidden: beat.forbidden ?? DEFAULT_STORY_FORBIDDEN,
  })),
).map((frame, index) => ({ ...frame, frameIndex: index + 1 }));

if (JOURNEY_TO_WEST_STORYBOARD.length !== JOURNEY_TO_WEST_TOTAL_FRAMES) {
  throw new Error(`Journey to the West storyboard must contain ${JOURNEY_TO_WEST_TOTAL_FRAMES} frames, got ${JOURNEY_TO_WEST_STORYBOARD.length}`);
}

export function getJourneyToWestFrame(targetIndex: number) {
  const safeIndex = Math.max(1, Math.floor(Number(targetIndex) || 1));
  return JOURNEY_TO_WEST_STORYBOARD[Math.min(safeIndex, JOURNEY_TO_WEST_STORYBOARD.length) - 1];
}

export function getJourneyToWestTemplateMeta() {
  return {
    storyTemplate: JOURNEY_TO_WEST_TEMPLATE,
    storyTemplateVersion: JOURNEY_TO_WEST_TEMPLATE_VERSION,
    storyTotalFrames: JOURNEY_TO_WEST_TOTAL_FRAMES,
  };
}
