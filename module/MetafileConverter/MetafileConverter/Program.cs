using System.Drawing;
using System.Drawing.Imaging;

namespace MetafileConverter
{
    class Program
    {
        static int Main(string[] args)
        {
            // 校验参数
            if (args.Length < 2)
            {
                Console.WriteLine("用法: MetafileConverter.exe <输入路径> <输出路径>");
                return 1;
            }

            string srcPath = args[0];
            string dstPath = args[1];

            try
            {
                if (!File.Exists(srcPath))
                {
                    Console.Error.WriteLine($"错误: 找不到文件 {srcPath}");
                    return 2;
                }

                // 核心转换逻辑
                using (var metafile = new Metafile(srcPath))
                {
                    // 获取矢量图原始尺寸
                    var header = metafile.GetMetafileHeader();
                    int width = (int)header.Bounds.Width;
                    int height = (int)header.Bounds.Height;

                    // 兜底处理：如果 Bounds 为 0，尝试读取 Size
                    if (width <= 0 || height <= 0)
                    {
                        width = (int)metafile.Size.Width;
                        height = (int)metafile.Size.Height;
                    }

                    // 最终兜底：如果还是 0，默认给个 800 像素
                    width = width > 0 ? width : 800;
                    height = height > 0 ? height : 600;

                    using (var bmp = new Bitmap(width, height))
                    {
                        using (var g = Graphics.FromImage(bmp))
                        {
                            g.Clear(Color.White); // 防止透明背景变黑色

                            // 高质量渲染设置
                            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;

                            g.DrawImage(metafile, 0, 0, width, height);
                        }

                        // 保存为 JPG，设置质量 90
                        var jpegCodec = GetEncoder(ImageFormat.Jpeg);
                        var encoderParams = new EncoderParameters(1);
                        encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 90L);

                        bmp.Save(dstPath, jpegCodec, encoderParams);
                    }
                }
                return 0; // 成功退出
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("转换失败: " + ex.Message);
                return -1;
            }
        }

        static ImageCodecInfo GetEncoder(ImageFormat format)
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageEncoders();
            foreach (ImageCodecInfo codec in codecs)
            {
                if (codec.FormatID == format.Guid) return codec;
            }
            return null;
        }
    }
}