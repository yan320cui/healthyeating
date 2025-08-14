// netlify/functions/food-recognition.js
// 百度菜品识别API的Netlify Functions实现

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
    const { image } = JSON.parse(event.body);
    
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
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'API配置错误' })
      };
    }

    // 第一步：获取Access Token
    const tokenResponse = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${API_KEY}&client_secret=${SECRET_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    if (!tokenResponse.ok) {
      throw new Error('获取Access Token失败');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error('Access Token无效');
    }

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
    params.append('top_num', '5'); // 返回识别结果数量
    params.append('filter_threshold', '0.7'); // 置信度阈值

    const recognitionResponse = await fetch(recognitionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!recognitionResponse.ok) {
      throw new Error('菜品识别API调用失败');
    }

    const recognitionData = await recognitionResponse.json();

    // 检查API返回的错误
    if (recognitionData.error_code) {
      throw new Error(`API错误: ${recognitionData.error_msg}`);
    }

    // 处理识别结果
    const results = recognitionData.result || [];
    
    // 转换为前端需要的格式
    const processedResults = results.map((item, index) => ({
      id: `baidu-${Date.now()}-${index}`,
      name: item.name,
      confidence: parseFloat(item.probability || 0),
      calorie: parseFloat(item.calorie || 0),
      estimatedWeight: 100, // 默认估计重量100g
      probability: item.probability,
      originalData: item
    }));

    // 返回成功结果
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        results: processedResults,
        total: results.length,
        log_id: recognitionData.log_id
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