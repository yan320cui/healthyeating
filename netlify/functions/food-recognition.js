// netlify/functions/food-recognition.js
// 百度菜品识别API的Netlify Functions实现

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // 设置CORS头
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // 处理OPTIONS预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // 只允许POST请求
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // 解析请求数据
    const { image, topNum = 5, baikeNum = 0, filterThreshold = 0.95 } = JSON.parse(event.body);
    
    if (!image) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: '缺少图片数据' })
      };
    }

    // 百度API配置（从环境变量获取）
    const API_KEY = process.env.BAIDU_API_KEY;
    const SECRET_KEY = process.env.BAIDU_SECRET_KEY;

    if (!API_KEY || !SECRET_KEY) {
      console.error('API配置缺失: API_KEY或SECRET_KEY未设置');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'API配置错误，请联系管理员' })
      };
    }

    console.log('开始获取百度Access Token...');
    
    // 第一步：获取Access Token
    const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${API_KEY}&client_secret=${SECRET_KEY}`;
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (!tokenResponse.ok) {
      console.error('获取Access Token失败:', tokenResponse.status);
      throw new Error('获取Access Token失败');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('Access Token无效:', tokenData);
      throw new Error('Access Token无效');
    }

    console.log('Access Token获取成功');

    // 处理图片数据（移除data:image/...;base64,前缀）
    let imageBase64 = image;
    if (image.includes(',')) {
      imageBase64 = image.split(',')[1];
    }

    // 第二步：调用菜品识别API
    const recognitionUrl = `https://aip.baidubce.com/rest/2.0/image-classify/v2/dish?access_token=${accessToken}`;
    
    // 构建请求参数
    const params = new URLSearchParams();
    params.append('image', imageBase64);
    params.append('top_num', topNum.toString());
    params.append('filter_threshold', filterThreshold.toString());
    params.append('baike_num', baikeNum.toString());

    console.log('调用百度菜品识别API...');
    
    const recognitionResponse = await fetch(recognitionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!recognitionResponse.ok) {
      console.error('菜品识别API调用失败:', recognitionResponse.status);
      throw new Error('菜品识别API调用失败');
    }

    const recognitionData = await recognitionResponse.json();
    console.log('API返回结果:', recognitionData);

    // 检查API返回的错误
    if (recognitionData.error_code) {
      console.error('API错误:', recognitionData.error_msg);
      
      // 处理特定错误码
      let errorMessage = '识别失败';
      switch(recognitionData.error_code) {
        case 216630:
          errorMessage = '识别无结果，请尝试更清晰的菜品图片';
          break;
        case 282810:
          errorMessage = 'URL图片无法下载';
          break;
        case 216200:
          errorMessage = '图片格式错误';
          break;
        case 216201:
          errorMessage = '图片尺寸错误';
          break;
        case 216202:
          errorMessage = '图片大小错误';
          break;
        case 216203:
          errorMessage = '图片编码错误';
          break;
        case 17:
          errorMessage = '每日请求量超限';
          break;
        case 18:
          errorMessage = 'QPS超限';
          break;
        case 19:
          errorMessage = '请求总量超限';
          break;
        default:
          errorMessage = `API错误: ${recognitionData.error_msg}`;
      }
      
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false,
          error: errorMessage,
          error_code: recognitionData.error_code 
        })
      };
    }

    // 处理识别结果
    const results = recognitionData.result || [];
    
    if (results.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          results: [],
          message: '未能识别出菜品，请尝试更清晰的图片',
          log_id: recognitionData.log_id
        })
      };
    }
    
    // 转换为前端需要的格式，包含营养信息
    const processedResults = results.map((item, index) => {
      // 百度API返回的calorie是每100g的卡路里值
      const caloriesPer100g = parseFloat(item.calorie || 0);
      
      // 估算一份的重量（默认200g）
      const estimatedWeight = 200;
      const totalCalories = Math.round((caloriesPer100g * estimatedWeight) / 100);
      
      // 根据热量估算其他营养成分（这是简化的估算）
      const protein = Math.round((totalCalories * 0.2) / 4); // 假设20%热量来自蛋白质
      const carbs = Math.round((totalCalories * 0.5) / 4);   // 假设50%热量来自碳水
      const fat = Math.round((totalCalories * 0.3) / 9);     // 假设30%热量来自脂肪
      
      return {
        id: `baidu-${Date.now()}-${index}`,
        name: item.name,
        confidence: parseFloat(item.probability || 0),
        calorie: caloriesPer100g,  // 每100g的卡路里
        totalCalories: totalCalories, // 估算一份的总卡路里
        estimatedWeight: estimatedWeight, // 估算重量(g)
        probability: item.probability,
        // 估算的营养成分
        nutrition: {
          calories: totalCalories,
          protein: protein,
          carbs: carbs,
          fat: fat,
          unit: `${estimatedWeight}g`
        },
        // 百度百科信息（如果有）
        baike_info: item.baike_info || null,
        originalData: item
      };
    });

    // 返回成功结果
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        results: processedResults,
        total: results.length,
        log_id: recognitionData.log_id,
        message: `成功识别${results.length}个菜品`
      })
    };

  } catch (error) {
    console.error('百度菜品识别API错误:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || '识别服务暂时不可用',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};